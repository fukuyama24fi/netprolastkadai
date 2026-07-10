const rectButton = document.getElementById("rect");
const circleButton = document.getElementById("circle");
const triangleButton = document.getElementById("triangle");
const textButton = document.getElementById("text");
const deleteButton = document.getElementById("delete");
const fillColorInput = document.getElementById("fillColor");
const canvas = document.getElementById("canvas");
const APIURL = "http://localhost:3000/canvas";



let selectedShape = null;
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

// 図形を選択する
function selectShape(shape) {
  // いま選択されている図形のselectedを外す
  document.querySelectorAll(".shape.selected").forEach((item) => {
    item.classList.remove("selected");
  });

  // 新しく選択した図形を保存する
  selectedShape = shape;
  selectedShape.classList.add("selected");

  // 選択した図形の色をカラーピッカーに反映する
  if (selectedShape.dataset.fillColor) {
    fillColorInput.value = selectedShape.dataset.fillColor;
  }
}

// 図形を追加する
function addShape(type) {
  const shape = document.createElement("div");

  // すべての図形にshapeクラスを付ける
  shape.classList.add("shape");

  // rect / circle / triangle / text のクラスを付ける
  shape.classList.add(type);

  shape.dataset.is=crypto.randomUUID;


  // 初期色
  let defaultColor = "#4f8cff";

  // テキストの場合だけ設定を変える
  if (type === "text") {
    defaultColor = "#222222";
    shape.textContent = "テキスト";
    shape.contentEditable = "false";
  }

  // 色を保存する
  shape.dataset.fillColor = defaultColor;

  // CSS変数に色を入れる
  shape.style.setProperty("--fill-color", defaultColor);

  // 追加するたびに少しずらす
  const shapeCount = canvas.querySelectorAll(".shape").length;
  const position = 80 + shapeCount * 20;

  shape.style.left = `${position}px`;
  shape.style.top = `${position}px`;

  // キャンバスに追加する
  canvas.appendChild(shape);

  // 追加した図形を選択する
  selectShape(shape);
  saveCanvasState();
}

// 四角形を追加
rectButton.addEventListener("click", () => {
  addShape("rect");
});

// 円を追加
circleButton.addEventListener("click", () => {
  addShape("circle");
});

// 三角形を追加
triangleButton.addEventListener("click", () => {
  addShape("triangle");
});

// テキストを追加
textButton.addEventListener("click", () => {
  addShape("text");
});

// 色を変更する
fillColorInput.addEventListener("input", () => {
  if (!selectedShape) {
    return;
  }

  const color = fillColorInput.value;

  selectedShape.dataset.fillColor = color;
  selectedShape.style.setProperty("--fill-color", color);
});

// 削除
deleteButton.addEventListener("click", () => {
  if (!selectedShape) {
    return;
  }

  selectedShape.remove();
  selectedShape = null;
  isDragging = false;

  saveCanvasState();
});

// 図形を押したとき
canvas.addEventListener("mousedown", (e) => {
  if (!e.target.classList.contains("shape")) {
    return;
  }

  // テキスト編集中はドラッグしない
  if (e.target.classList.contains("text") && e.target.isContentEditable) {
    return;
  }

  selectShape(e.target);

  isDragging = true;

  const shapeRect = selectedShape.getBoundingClientRect();

  offsetX = e.clientX - shapeRect.left;
  offsetY = e.clientY - shapeRect.top;

  e.preventDefault();
});

// テキストをダブルクリックしたら編集できるようにする
canvas.addEventListener("dblclick", (e) => {
  if (!e.target.classList.contains("text")) {
    return;
  }

  selectShape(e.target);

  e.target.contentEditable = "true";
  e.target.focus();
});

// テキストから離れたら編集終了
canvas.addEventListener("focusout", (e) => {
  if (!e.target.classList.contains("text")) {
    return;
  }

  e.target.contentEditable = "false";
});

// マウスを動かしたとき
document.addEventListener("mousemove", (e) => {
  if (!isDragging || !selectedShape) {
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();

  const newLeft = e.clientX - canvasRect.left - offsetX;
  const newTop = e.clientY - canvasRect.top - offsetY;

  selectedShape.style.left = `${newLeft}px`;
  selectedShape.style.top = `${newTop}px`;
});

// マウスを離したとき
document.addEventListener("mouseup", () => {
  if(isDragging){
    isDragging=false;
    saveCanvasState();
  }
});





function getShapeType(shape) {
  if (shape.classList.contains("circle")) {
    return "circle";
  }

  if (shape.classList.contains("triangle")) {
    return "triangle";
  }

  return "rect";
}

async function saveCanvasState() {
  const shapes = document.querySelectorAll(".shape");

  const state = Array.from(shapes).map((shape) => {
    return {
      id: shape.dataset.id,
      type: getShapeType(shape),
      left: shape.style.left,
      top: shape.style.top
    };
  });

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(state)
    });

    const result = await response.json();

    console.log("保存成功:", result);
  } catch (error) {
    console.error("保存失敗:", error);
  }
}
