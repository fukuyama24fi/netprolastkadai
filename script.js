const rectButton = document.getElementById("rect");
const circleButton = document.getElementById("circle");
const deleteButton = document.getElementById("delete");
const triangleButton = document.getElementById("triangle");
const canvas = document.getElementById("canvas");

let selectedShape = null;
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

//図形を選択
function selectShape(type) {
  document.querySelectorAll(".shape.selected").forEach((item) => {
    item.classList.remove("selected");
  });

  selectedShape = type;
  selectedShape.classList.add("selected");

  if(selectShape.dataset.fillColor){
    fillColorInput.value=selectShape.dataset.fillColor;
  }
}

//図形を追加
function addShape(type) {
  const shape = document.createElement("div");
  shape.classList.add("shape");

  let defayltColor = "#00000";

if(type=="text"){
  defayltColor="fffff";
  shape.textContent="テキスト";
  shape.isContentEditable = "false";
}

shape.dataset.fillColor=defayltColor;
shape.style.setProperty("--fill-color",defayltColor);

const shapeCount = canvas.querySelectorAll(".shape").length;
const position = 80 + shapeCount*20;

shape.style.left='${position}px';
shape.style.top='${position}px';

canvas.appendChild(shape);
selectedShape(shape);
}




rectButton.addEventListener("click", () => {
  addShape("rect");
});

circleButton.addEventListener("click", () => {
  addShape("circle");
});

triangleButton.addEventListener("click", () => {
  addShape("triangle");
});

deleteButton.addEventListener("click", () => {
  if (selectedShape) {
    selectedShape.remove();
    selectedShape = null;
  }
});

canvas.addEventListener("mousedown", (e) => {
  if (!e.target.classList.contains("shape")) {
   return;
  }

   selectShape(e.target);
    isDragging = true;
    const shapeRect = selectedShape.getBoundingClientRect();

    offsetX = e.clientX - shapeRect.left;
    offsetY = e.clientY - shapeRect.top;

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging || !selectedShape) {
     return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const newLeft = e.clientX - canvasRect.left- offsetX;
    const newTop = e.clientY - canvasRect.top- offsetY;

    selectedShape.style.left = `${newLeft}px`;
    selectedShape.style.top = `${newTop}px`;
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });


