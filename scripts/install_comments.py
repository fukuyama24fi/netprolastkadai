#!/usr/bin/env python3
"""Install the Pikva history comments feature in an existing repository.

Run at project root after extracting zip:
    py scripts/install_comments.py

The script edits only client/src/App.jsx and server/server.js. If the
repository has diverged, it raises an error rather than modifying the wrong
location. Changes are idempotent. No external Python packages are required.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
APP = PROJECT / "client/src/App.jsx"
SERVER = PROJECT / "server/server.js"
BACKUP = PROJECT / ".pikva_comments_backup"


def insert_once(text: str, pattern: str, replacement: str, description: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise RuntimeError(
            f"{description} を挿入できませんでした。GitHubのコード構造が変わっている可能性があります。"
        )
    return updated


def patch_app(text: str) -> str:
    if 'import HistoryComments from "./components/HistoryComments";' not in text and \
       "import HistoryComments from './components/HistoryComments';" not in text:
        text = insert_once(
            text,
            r'^(import\s+["\']\./App\.css["\'];?)',
            'import HistoryComments from "./components/HistoryComments";\n\\1',
            "App.jsx の import 文",
        )

    # Independent sibling before history tab pane. History's scroll-to-end
    # must not scroll the comments out of sight.
    if '<HistoryComments userName={userName} />' not in text:
        text = insert_once(
            text,
            r'^(\s*)(\{sidebarTab === ["\']ai["\'] \? \()',
            r'\1{sidebarTab === "history" && <HistoryComments userName={userName} />}\n\1\2',
            "App.jsx の編集履歴タブ",
        )

    if '<HistoryComments userName={userName} />' not in text:
        raise RuntimeError("App.jsx の表示部分にコメント欄を追加できませんでした")
    return text


def patch_server(text: str) -> str:
    if 'attachHistoryComments' not in text or 'initializeHistoryComments' not in text:
        if "from './historyComments.js'" not in text and 'from "./historyComments.js"' not in text:
            text = insert_once(
                text,
                r'^(import\s+\{\s*pool\s*\}\s+from\s+["\']\./config/db\.js["\'];?[^\n]*)',
                r'\1\nimport { initializeHistoryComments, attachHistoryComments } from "./historyComments.js";',
                "server.js の import 文",
            )
        if 'await initializeHistoryComments(pool);' not in text:
            text = insert_once(
                text,
                r'^(\s*await\s+pool\.query\(["\']SELECT 1["\']\);)',
                r'''\1
        // コメントを別テーブルに保存（既存の編集データには影響しない）
        try {
            await initializeHistoryComments(pool);
            console.log("共同コメント: DB初期化完了");
        } catch (commentError) {
            console.error("共同コメント: DB初期化失敗。history_comments.sql を確認してください", commentError);
        }''',
                "server.js のデータベース初期化",
            )
        if 'attachHistoryComments(socket, io, pool,' not in text:
            text = insert_once(
                text,
                r'^(\s*sendHistory\(socket\);)',
                r'\1\n\n    // 同じ共同編集キャンバスに接続したユーザーとコメントを同期\n    attachHistoryComments(socket, io, pool,\n        () => userNames[connectedUserId] || connectedUserName, connectedUserId);',
                "server.js の Socket.IO イベント登録",
            )
    if 'await initializeHistoryComments(pool);' not in text or \
       'attachHistoryComments(socket, io, pool,' not in text:
        raise RuntimeError("server.js にコメント機能を追加できませんでした")
    return text


def install() -> None:
    expected_files = [
        APP, SERVER,
        PROJECT / 'client/src/components/HistoryComments.jsx',
        PROJECT / 'client/src/components/HistoryComments.css',
        PROJECT / 'server/historyComments.js',
    ]
    missing = [str(path.relative_to(PROJECT)) for path in expected_files if not path.is_file()]
    if missing:
        raise RuntimeError(
            'ZIPをプロジェクトのルート(netprolastkadai)に展開してください。見つからないファイル: '
            + ', '.join(missing)
        )

    # Make sure every patch succeeds before touching existing files.
    changes = {APP: patch_app(APP.read_text(encoding='utf-8')),
               SERVER: patch_server(SERVER.read_text(encoding='utf-8'))}
    for path, updated in changes.items():
        old = path.read_text(encoding='utf-8')
        relative = path.relative_to(PROJECT)
        if old == updated:
            print(f'✅ すでに適用済み: {relative}')
            continue
        destination = BACKUP / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            shutil.copy2(path, destination)
        path.write_text(updated, encoding='utf-8')
        print(f'✅ コメント機能を追加: {relative}')

    print('\n✅ 完了: App.jsx にコメント欄が、server.js にコメント保存・配信が組み込まれています。')
    print('次に client の npm run build、server の node --check server.js を実行してください。')
    print('git status → git add / commit / push → フロント・バック両方再デプロイが必要です。')


if __name__ == '__main__':
    try:
        install()
    except Exception as error:
        print(f'❌ インストール失敗: {error}')
        raise SystemExit(1)
