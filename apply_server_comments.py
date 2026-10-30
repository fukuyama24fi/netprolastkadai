
from __future__ import annotations

import argparse
import datetime as dt
import re
import shutil
import sys
from pathlib import Path

IMPORT_LINE = "import { initializeHistoryComments, attachHistoryComments } from './historyComments.js';"
INITIALIZE_BLOCK = '''
        // 共同コメント専用テーブル。編集履歴/Undoとは独立させる。
        try {
            await initializeHistoryComments(pool);
            console.log("共同コメント用テーブル確認完了");
        } catch (error) {
            // キャンバスなど既存機能は引き続き使用できるようにする。
            // コメント送信エラーの際は、まずこのログを確認すること。
            console.error("共同コメント用テーブル初期化失敗:", error);
        }
'''
ATTACH_BLOCK = '''
    // 接続ユーザーごとにコメント一覧/送信用Socket.IOイベントを登録する。
    attachHistoryComments(
        socket, io, pool,
        () => userNames[connectedUserId] || connectedUserName,
        connectedUserId
    );
'''


def unique_insert(source: str, *, marker: str, anchor: str, inserted: str, description: str) -> tuple[str, bool]:
    count = source.count(marker)
    if count == 1:
        print(f"  ✓ {description}: 既に登録済み")
        return source, False
    if count > 1:
        raise ValueError(f"{description} が複数見つかりました。安全のため中止します。")
    if source.count(anchor) != 1:
        raise ValueError(f"{description} の挿入箇所を特定できません。安全のため中止します。")
    return source.replace(anchor, anchor + inserted, 1), True


def main() -> int:
    parser = argparse.ArgumentParser(description="Pikva コメント送信用バックエンド修正")
    parser.add_argument("--root", type=Path, help="Pikvaリポジトリのルート (省略時はこのスクリプトのある場所)")
    parser.add_argument("--check", action="store_true", help="変更せずに確認のみ")
    args = parser.parse_args()
    root = (args.root or Path(__file__).resolve().parent).resolve()
    target = root / "server" / "server.js"
    module = root / "server" / "historyComments.js"
    bundled_module = Path(__file__).resolve().parent / "server" / "historyComments.js"

    if not target.is_file():
        print(f"❌ 見つかりません: {target}\nPikvaフォルダ直下にZIPを展開してください。", file=sys.stderr)
        return 1
    if not module.is_file() and not bundled_module.is_file():
        print("❌ server/historyComments.js がありません。ZIPの配置を確認してください。", file=sys.stderr)
        return 1
    source = target.read_text(encoding="utf-8")
    if "io.on('connection'" not in source and 'io.on("connection"' not in source:
        print("❌ Socket.IO接続処理が見つかりません。別版のserver.jsの可能性があります。", file=sys.stderr)
        return 1
    try:
        # 一部だけ適用済みの場合も不足箇所のみを追加する。
        # 先頭importは該当行の末尾を含めて一致させる（日本語コメントあり）。
        import_match = re.search(r"^import\s+\{\s*pool\s*\}\s+from\s+['\"]\./config/db\.js['\"];[^\n]*$", source, flags=re.MULTILINE)
        if source.count("initializeHistoryComments, attachHistoryComments") == 0:
            if not import_match:
                raise ValueError("db.js の import が見つかりません")
            source = source[:import_match.end()] + "\n" + IMPORT_LINE + source[import_match.end():]
            print("  + server.js: import を追加")
        else:
            print("  ✓ server.js: import は登録済み")

        source, init_added = unique_insert(
            source,
            marker="await initializeHistoryComments(pool)",
            anchor='console.log("データベース接続成功");',
            inserted=INITIALIZE_BLOCK,
            description="DBテーブル初期化",
        )
        source, attach_added = unique_insert(
            source,
            marker="attachHistoryComments(",
            anchor="    sendHistory(socket);",
            inserted=ATTACH_BLOCK,
            description="Socket.IOコメントイベント",
        )
    except ValueError as err:
        print(f"❌ {err}", file=sys.stderr)
        return 1

    if args.check:
        print("✅ チェック完了（ファイルは変更していません）")
        return 0

    original = target.read_text(encoding="utf-8")
    if source == original and module.is_file():
        print("✅ 既にバックエンドのコードは適用されています。Renderのデプロイ状態とDBを確認してください。")
        return 0
    if source != original:
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = root / ".pikva-local-backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / f"server.js.{stamp}.bak"
        shutil.copy2(target, backup)
        target.write_text(source, encoding="utf-8")
        print(f"  ✓ server.jsを修正（バックアップ: {backup.relative_to(root)}）")
    if not module.is_file():
        shutil.copy2(bundled_module, module)
        print("  ✓ server/historyComments.js を配置")
    print("✅ 完了！ 次は node --check server/server.js を実行してください。")
    print("⚠ .pikva-local-backups はgitに追加しないでください。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
