const rectButton = document.getElementById("rect");
const canvas = document.getElementById("canvas");

let selectedShape = null;
let isDragging = false;
let offsetX = 0;
let offsetY = 0;


rectButton.addEventListener("click", () => {
  const shape = document.createElement("div");

  shape.classList.add("shape");

  canvas.appendChild(shape);
});


canvas.addEventListener("mousedown", (e) => {
  if (e.target.classList.contains("shape")) {
    selectedShape = e.target;

    document.querySelectorAll(".shape").forEach((shape) => {
      shape.classList.remove("selected");
    });

    selectedShape.classList.add("selected");

    isDragging = true;

    const shapeRect = selectedShape.getBoundingClientRect();

    offsetX = e.clientX - shapeRect.left;
    offsetY = e.clientY - shapeRect.top;
  }
});


document.addEventListener("mousemove", (e) => {
  if (!isDragging || !selectedShape) return;

  const canvasRect = canvas.getBoundingClientRect();

  selectedShape.style.left = `${e.clientX - canvasRect.left - offsetX}px`;
  selectedShape.style.top = `${e.clientY - canvasRect.top - offsetY}px`;
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});