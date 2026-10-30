#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "client/src/App.jsx"
SERVER = ROOT / "server/server.js"


def insert_once(content: str, fragment: str, needle: str, result: str, label: str) -> str:
    if fragment in content:
        return content
    if content.count(needle) != 1:
        raise RuntimeError(f"{label}: 挿入先が見つからないか複数あります。元のファイルを手動確認してください。")
    return content.replace(needle, result, 1)


def patch_app(content: str) -> str:
    import_anchor = 'import AiChatPanel from "./components/AiChatPanel";'
    new_import = 'import HistoryComments from "./components/HistoryComments";'
    content = insert_once(
        content, new_import, import_anchor,
        import_anchor + '\n' + new_import, "App.jsx import"
    )
    if '<HistoryComments userName={userName} />' not in content:
        # 親の履歴スクロール領域の外へ置く。中に置くと履歴の自動スクロールで
        # コメント投稿欄が画面外に追いやられる。
        open_re = re.compile(r'(\)\s*:\s*\()\s*(<div\s+className="history-scroll")')
        content, num_open = open_re.subn(
            r'\1\n            <>\n              <HistoryComments userName={userName} />\n          \2',
            content, count=1
        )
        if num_open != 1:
            raise RuntimeError("App.jsx: history-scroll タブの開始部分を特定できません。")
        end_re = re.compile(
            r'(\s*</div>)\s*(\)\})\s*(\{/\* ここまでが履歴タブの中身 \*/\})'
        )
        content, num_close = end_re.subn(
            r'\1\n            </>\n          \2\n          \3',
            content, count=1
        )
        if num_close != 1:
            raise RuntimeError("App.jsx: history-scroll タブの終了部分を特定できません。")
    return content


def patch_server(content: str) -> str:
    import_anchor = "import { pool } from './config/db.js';"
    new_import = "import { initializeHistoryComments, attachHistoryComments } from './historyComments.js';"
    content = insert_once(
        content, new_import, import_anchor,
        import_anchor + '\n' + new_import, "server.js import"
    )
    init_anchor = '        await pool.query("SELECT 1");'
    init_snippet = '''        // コメント欄は追加機能。テーブル作成不可でも既存の共同編集サーバーは起動させる。
        try {
            await initializeHistoryComments(pool);
        } catch (commentError) {
            console.error("コメントテーブル初期化失敗。DB権限とREADMEを確認:", commentError);
        }'''
    content = insert_once(
        content, 'await initializeHistoryComments(pool);', init_anchor,
        init_anchor + '\n' + init_snippet, "server.js DB 初期化"
    )
    attach_anchor = '    sendHistory(socket);'
    attach_snippet = (
        '    attachHistoryComments(socket, io, pool, '
        '() => userNames[connectedUserId] || connectedUserName, connectedUserId);'
    )
    content = insert_once(
        content, 'attachHistoryComments(socket, io, pool,', attach_anchor,
        attach_anchor + '\n' + attach_snippet, "server.js Socket.IO"
    )
    return content


def main() -> int:
    required_files = [
        ROOT / "client/src/main.jsx",
        ROOT / "client/src/components/StartScreen.jsx",
        ROOT / "client/src/components/HistoryComments.jsx",
        ROOT / "server/historyComments.js",
    ]
    missing = [str(path.relative_to(ROOT)) for path in required_files if not path.is_file()]
    if missing:
        raise RuntimeError("ZIPをリポジトリのルートへ展開してください。不足: " + ", ".join(missing))
    if not APP.is_file() or not SERVER.is_file():
        raise RuntimeError("client/src/App.jsx または server/server.js が見つかりません。")

    # 2つのパッチをメモリ上で作り終えてから実際のファイルを更新（部分適用を防ぐ）。
    new_contents = {APP: patch_app(APP.read_text(encoding="utf-8")),
                    SERVER: patch_server(SERVER.read_text(encoding="utf-8"))}
    backups = ROOT / ".pikva_patch_backup"
    for path, new_content in new_contents.items():
        original = path.read_text(encoding="utf-8")
        if original == new_content:
            print(f"変更済み: {path.relative_to(ROOT)}")
            continue
        backups.mkdir(exist_ok=True)
        backup = backups / path.relative_to(ROOT)
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copy2(path, backup)
        path.write_text(new_content, encoding="utf-8")
        print(f"適用完了: {path.relative_to(ROOT)} (バックアップ: {backup.relative_to(ROOT)})")
    print("完了。client の npm run build と、server の node --check server.js を実行してください。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        sys.exit(1)
