// キャンバスのJSON配列からHTMLコードを生成する関数
function generateHTMLCode(objects) {
    // 各オブジェクトをHTMLタグの文字列に変換
    const elements = objects.map(obj => {
        // 基本のスタイル（位置、サイズ、色など）を定義
        let style = `position: absolute; left: ${obj.x}px; top: ${obj.y}px; width: ${obj.width}px; height: ${obj.height}px; background-color: ${obj.fill};`;
        
        // 図形ごとの特殊なスタイルを追加
        if (obj.type === 'circle') {
            style += ' border-radius: 50%;';
        }
        
        // テキストがあれば中に入れる
        const innerText = obj.text ? obj.text : '';

        return `<div id="${obj.id}" class="${obj.type}" style="${style}">${innerText}</div>`;
    });

    // 最終的なHTMLのひな形に流し込む
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>Pikva Generated Code</title>
    <style>
        .canvas-container { position: relative; width: 100vw; height: 100vh; overflow: hidden; background-color: #f0f0f0; }
    </style>
</head>
<body>
    <div class="canvas-container">
        ${elements.join('\n        ')}
    </div>
</body>
</html>`;
}