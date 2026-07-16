/**
 * ユーザー操作ハンドラ用
 * ドラッグ、リサイズ、回転などの開始処理
 */

import { useCallback } from "react";

/**
 * ユーザー操作ハンドラフック
 * @returns {object} 操作ハンドラ関数群
 */
export function useInteractionHandlers() {
  /**
   * 図形ドラッグ開始
   * @param {event} event - マウスイベント
   * @param {object} shape - ドラッグ対象の図形
   * @param {object} refs 
   */
  const startDrag = useCallback(
    (event, shape, { canvasRef, setInteraction, setSelectedId, setEditingId }) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      setSelectedId(shape.id);
      setEditingId(null);

      const canvasRect = canvas.getBoundingClientRect();

      setInteraction({
        mode: "drag",
        id: shape.id,
        offsetX: event.clientX - canvasRect.left - shape.x,
        offsetY: event.clientY - canvasRect.top - shape.y,
      });

      event.preventDefault();
    },
    []
  );

  /**
   * 図形リサイズ開始
   * @param {event} event - マウスイベント
   * @param {object} shape - リサイズ対象の図形
   * @param {object} setters - state設定関数群
   */
  const startResize = useCallback(
    (event, shape, { setInteraction, setSelectedId, setEditingId }) => {
      event.stopPropagation();
      event.preventDefault();

      setSelectedId(shape.id);
      setEditingId(null);

      setInteraction({
        mode: "resize",
        id: shape.id,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: shape.width,
        startHeight: shape.height,
      });
    },
    []
  );

  /**
   * 図形回転開始
   * @param {event} event - マウスイベント
   * @param {object} shape - 回転対象の図形
   * @param {object} setters - state設定関数群
   */
  const startRotate = useCallback(
    (event, shape, { setInteraction, setSelectedId, setEditingId }) => {
      event.stopPropagation();
      event.preventDefault();

      const shapeElement = event.currentTarget.closest(".shape");

      if (!shapeElement) {
        return;
      }

      const shapeRect = shapeElement.getBoundingClientRect();

      const centerX = shapeRect.left + shapeRect.width / 2;
      const centerY = shapeRect.top + shapeRect.height / 2;

      const startPointerAngle =
        (Math.atan2(event.clientY - centerY, event.clientX - centerX) *
          180) /
        Math.PI;

      setSelectedId(shape.id);
      setEditingId(null);

      setInteraction({
        mode: "rotate",
        id: shape.id,
        centerX,
        centerY,
        startPointerAngle,
        startRotation: shape.rotation || 0,
      });
    },
    []
  );

  /**
   * テキスト編集開始
   * @param {event} event - マウスイベント
   * @param {object} shape - テキスト図形
   * @param {object} setters - state設定関数群
   */
  const startTextEditing = useCallback(
    (event, shape, { setSelectedId, setInteraction, setDraftText, setEditingId }) => {
      event.stopPropagation();

      if (shape.type !== "text") {
        return;
      }

      setSelectedId(shape.id);
      setInteraction(null);
      setDraftText(shape.text || "");
      setEditingId(shape.id);
    },
    []
  );

  return {
    startDrag,
    startResize,
    startRotate,
    startTextEditing,
  };
}
