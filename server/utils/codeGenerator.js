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
        // 図形ごとのスタイル
        if (obj.type === 'circle') {
            style += ' border-radius: 50%; background-color: ' + obj.fill + ';';
        } else if (obj.type === 'triangle') {
            style += ' clip-path: polygon(50% 0%, 100% 100%, 0% 100%); background-color: ' + obj.fill + ';';
        } else if (obj.type === 'text') {
            // テキストの場合、背景は透明、文字色をfillに設定
            style += ` background-color: transparent; color: ${obj.fill}; font-size: ${obj.fontSize || 24}px;`;
        } else {
            style += ' background-color: ' + obj.fill + ';';
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

// 他のファイルで使えるように export
export { generateHTMLCode };

// キャンバスのJSON配列からCSSコードを生成する関数（HTMLとは別ファイル用）
function generateCSSCode(objects) {
    const rules = objects.map(obj => {
        const declarations = [
            'position: absolute',
            `left: ${obj.x}px`,
            `top: ${obj.y}px`,
            `width: ${obj.width}px`,
            `height: ${obj.height}px`,
        ];

        if (obj.type === 'circle') {
            declarations.push('border-radius: 50%', `background-color: ${obj.fill}`);
        } else if (obj.type === 'triangle') {
            declarations.push('clip-path: polygon(50% 0%, 100% 100%, 0% 100%)', `background-color: ${obj.fill}`);
        } else if (obj.type === 'text') {
            declarations.push('background-color: transparent', `color: ${obj.fill}`, `font-size: ${obj.fontSize || 24}px`);
        } else {
            declarations.push(`background-color: ${obj.fill}`);
        }

        if (obj.rotation) {
            declarations.push(`transform: rotate(${obj.rotation}deg)`);
        }

        return `#${obj.id} {\n  ${declarations.join(';\n  ')};\n}`;
    });

    return `.canvas-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #f0f0f0;
}

${rules.join('\n\n')}`;
}

export { generateHTMLCode, generateCSSCode };