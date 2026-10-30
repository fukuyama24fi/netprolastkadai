#!/usr/bin/env python3
"""Enable existing Pikva shared-comment sockets without replacing server.js wholesale.

Safety: checks anchor uniqueness, backs up original, modifies only three call sites,
re-runnable and verifies Node syntax when Node is installed.
"""
from __future__ import annotations

import datetime
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / 'server' / 'server.js'
BACKUPS = ROOT / '.pikva-local-backups'


def insert_after_unique(source: str, pattern: str, addition: str, label: str) -> str:
    matches = list(re.finditer(pattern, source, flags=re.MULTILINE))
    if len(matches) != 1:
        raise RuntimeError(f'{label}: 挿入場所が {len(matches)} 件でした。安全のため変更しません。')
    m = matches[0]
    newline = '\r\n' if '\r\n' in source else '\n'
    insertion = addition.replace('\n', newline)
    return source[:m.end()] + newline + insertion + source[m.end():]


def update(source: str) -> tuple[str, list[str]]:
    changes: list[str] = []
    # Keep imports as they are, unless the file was partially installed.
    if not re.search(r'(?m)^\s*import\s*\{[^\n]*\binitializeHistoryComments\b[^\n]*\battachHistoryComments\b[^\n]*\}\s*from\s*[\'\"]\./historyComments\.js[\'\"]', source):
        import_line = "import { initializeHistoryComments, attachHistoryComments } from './historyComments.js';"
        source = insert_after_unique(
            source,
            r'^\s*import\s*\{\s*pool\s*\}\s*from\s*[\'\"]\./config/db\.js[\'\"];[^\n]*',
            import_line,
            'コメントモジュールのimport',
        )
        changes.append('コメント処理のimportを追加')

    if not re.search(r'(?m)^\s*await\s+initializeHistoryComments\s*\(', source):
        init_block = (
            '        // 共同コメントは本体の編集履歴とは別のテーブルに保存。\n'
            '        // テーブル準備に失敗してもキャンバス本体の起動は妨げない。\n'
            '        try {\n'
            '            await initializeHistoryComments(pool);\n'
            '            console.log("共同コメント用テーブル確認完了");\n'
            '        } catch (error) {\n'
            '            console.error("共同コメント用テーブル初期化失敗:", error);\n'
            '        }'
        )
        source = insert_after_unique(
            source,
            r'^[ \t]*console\.log\([\'\"]データベース接続成功[\'\"]\);[ \t]*',
            init_block,
            'DB接続直後の初期化',
        )
        changes.append('起動時のhistory_comments初期化を追加')

    if not re.search(r'(?m)^\s*attachHistoryComments\s*\(', source):
        attach_block = (
            '    // コメント一覧の取得・投稿をSocket.IOへ登録。\n'
            '    // SET_USERNAMEで変更された名前を投稿時に反映する。\n'
            '    attachHistoryComments(\n'
            '        socket, io, pool,\n'
            '        () => userNames[connectedUserId] || connectedUserName,\n'
            '        connectedUserId\n'
            '    );'
        )
        source = insert_after_unique(
            source,
            r'^[ \t]*sendHistory\(socket\);[ \t]*',
            attach_block,
            'Socket.IO接続時のコメント登録',
        )
        changes.append('Socket.IOのhistoryComments:list/addを有効化')
    return source, changes


def main() -> int:
    if not TARGET.is_file():
        print(f'ERROR: {TARGET} が見つかりません。')
        print('ZIPを netprolastkadai のルート（client と server がある場所）へ展開してください。')
        return 2
    if not (ROOT / 'server' / 'historyComments.js').is_file():
        print('ERROR: server/historyComments.js がありません。ZIPを上書き展開してください。')
        return 2
    original = TARGET.read_bytes()
    try:
        # Keep UTF-8 BOM, if present, and preserve existing CRLF line endings.
        bom = b'\xef\xbb\xbf' if original.startswith(b'\xef\xbb\xbf') else b''
        source = original[len(bom):].decode('utf-8')
        modified, changes = update(source)
    except Exception as error:
        print(f'ERROR: {error}')
        return 2

    if not changes:
        print('OK: コメント機能は既にserver.jsへ登録済みです。変更は不要でした。')
    else:
        BACKUPS.mkdir(exist_ok=True)
        stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        backup = BACKUPS / f'server.js.comments_{stamp}.bak'
        backup.write_bytes(original)
        new_bytes = bom + modified.encode('utf-8')
        TARGET.write_bytes(new_bytes)
        print('OK: server/server.js を修正しました。')
        print('変更点:', ' / '.join(changes))
        print('バックアップ:', backup)

    node = shutil.which('node')
    if node:
        for file in (TARGET, ROOT / 'server' / 'historyComments.js'):
            result = subprocess.run([node, '--check', str(file)], capture_output=True, text=True)
            if result.returncode:
                print('ERROR: JavaScript構文チェックに失敗:', file)
                print(result.stderr)
                if changes:
                    TARGET.write_bytes(original)
                    print('server/server.jsはバックアップ前の状態へ復元しました。')
                return 1
        print('OK: node --check 構文チェック成功（2ファイル）')
    else:
        print('WARNING: Node.jsが見つからないため構文チェックを省略しました。')
    print('NEXT: git diff -- server/server.js を確認後、GitHubへpushしRenderを再デプロイしてください。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
