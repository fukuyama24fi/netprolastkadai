#!/usr/bin/env python3
"""Pikva: activate history comments in existing server/server.js without overwriting other features."""
from __future__ import annotations
import datetime
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / 'server' / 'server.js'
COMMENTS = ROOT / 'server' / 'historyComments.js'
BACKUPS = ROOT / '.pikva-local-backups'


def unique_sub(pattern: str, repl: str, text: str, label: str) -> str:
    matches = list(re.finditer(pattern, text, re.M))
    if len(matches) != 1:
        raise ValueError(f'{label}: 挿入位置が {len(matches)} 件 (期待: 1)。安全のため中止。')
    m = matches[0]
    return text[:m.end()] + repl + text[m.end():]


def patch(text: str):
    notes = []
    imp = r'(?m)^\s*import\s*\{[^}]*\battachHistoryComments\b[^}]*\}\s*from\s*[\'\"]\./historyComments\.js[\'\"];?'
    init = r'(?m)^\s*await\s+initializeHistoryComments\s*\(\s*pool\s*\)\s*;'
    attach = r'(?m)^\s*attachHistoryComments\s*\('

    if not re.search(imp, text):
        if re.search(r'\battachHistoryComments\b', text) or re.search(r'\binitializeHistoryComments\b', text):
            raise ValueError('コメント関連のコードが部分的にあります。二重登録防止のため停止。server.jsを確認してください。')
        line = "\nimport { initializeHistoryComments, attachHistoryComments } from './historyComments.js';"
        text = unique_sub(r'^\s*import\s*\{\s*pool\s*\}\s*from\s*[\'\"]\./config/db\.js[\'\"];?[^\n]*', line, text, 'import行')
        notes.append('コメントモジュールのimportを追加')

    if not re.search(init, text):
        addition = '''\n        // History comments: isolated table; failure must not stop the canvas server.
        try {
            await initializeHistoryComments(pool);
            console.log("[comments] table ready");
        } catch (error) {
            console.error("[comments] table setup failed:", error);
        }'''
        text = unique_sub(r'^[ \t]*console\.log\([\'\"]データベース接続成功[\'\"]\);[ \t]*', addition, text, 'DB接続直後')
        notes.append('起動時テーブル初期化を追加')

    if not re.search(attach, text):
        addition = '''\n    // History comments: register list/add handlers on each connected socket.
    attachHistoryComments(
        socket, io, pool,
        () => userNames[connectedUserId] || connectedUserName,
        connectedUserId
    );
    console.log("[comments] socket handlers ready:", socket.id);'''
        text = unique_sub(r'^[ \t]*sendHistory\(socket\);[ \t]*', addition, text, '接続時リスナー登録')
        notes.append('historyComments:list/add のリスナー登録を追加')

    # Verify there are no missing integration sites or accidental duplicate registration.
    checks = {'import': len(re.findall(imp, text)), 'init': len(re.findall(init, text)), 'attach': len(re.findall(attach, text))}
    if checks != {'import': 1, 'init': 1, 'attach': 1}:
        raise ValueError(f'整合性チェック失敗: {checks}')
    return text, notes


def check_js(path: Path):
    node = shutil.which('node')
    if not node:
        print('注意: nodeが見つからず構文検査を実行できません。')
        return True
    p = subprocess.run([node, '--check', str(path)], capture_output=True, text=True)
    if p.returncode:
        print(f'ERROR: 構文エラー: {path}\n{p.stderr}')
        return False
    print(f'OK: 構文確認 {path.relative_to(ROOT)}')
    return True


def main():
    print('== Pikva コメント接続 修復 v6 ==')
    if not SERVER.is_file() or not COMMENTS.is_file():
        print('ERROR: server/server.js または server/historyComments.js がありません。')
        print('ZIPを netprolastkadai の直下へ展開してください。')
        return 2
    original = SERVER.read_bytes()
    bom = b'\xef\xbb\xbf' if original.startswith(b'\xef\xbb\xbf') else b''
    try:
        source = original[len(bom):].decode('utf-8')
        newline = '\r\n' if '\r\n' in source else '\n'
        # Work in normalized text, restore original line endings on output.
        normalized = source.replace('\r\n','\n')
        result, notes = patch(normalized)
    except Exception as error:
        print('ERROR:', error)
        return 2
    if notes:
        updated = bom + result.replace('\n', newline).encode('utf-8')
        # Check BEFORE overwriting server.js. Use a .js temporary file in same ESM package.
        pending = SERVER.with_name('_pikva_comments_check_temp.js')
        try:
            pending.write_bytes(updated)
            if not check_js(pending):
                print('ERROR: 元のserver.jsは変更していません。')
                return 1
        finally:
            pending.unlink(missing_ok=True)
        BACKUPS.mkdir(exist_ok=True)
        backup = BACKUPS / ('server.js.before_comments_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f') + '.bak')
        backup.write_bytes(original)
        tmp = SERVER.with_name('_pikva_server_write_temp.js')
        try:
            tmp.write_bytes(updated)
            os.replace(tmp, SERVER)
        finally:
            tmp.unlink(missing_ok=True)
        print('OK: server/server.js を更新しました。')
        for note in notes: print('  +', note)
        print('バックアップ:', backup.relative_to(ROOT))
    else:
        print('OK: コメント処理の登録はすでに完了しています（変更なし）。')
    assert check_js(SERVER)
    assert check_js(COMMENTS)
    print('NEXT: GitHubに server/server.js を push → Render のバックエンドを新コミットでデプロイ。')
    print('Render ログ: [comments] table ready / [comments] socket handlers ready が目印です。')
    return 0

if __name__ == '__main__':
    sys.exit(main())
