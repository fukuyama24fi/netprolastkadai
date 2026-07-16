/**
 * キャンバス状態管理用
 */

import { useCallback } from "react";

/**
 * キャンバス状態管理フック
 * @param {object} canvasState - 初期キャンバス状態
 * @returns {object} 状態管理関数群
 */
export function useCanvasState(canvasState) {
  /**
   * ローカルで図形を更新
   * @param {string} id - 図形ID
   * @param {object} changes - 変更内容
   * @param {function} setViewShapes - ビュー図形更新関数
   * @param {object} viewShapesRef - ビュー図形参照
   */
  const updateShapeLocal = useCallback(
    (id, changes, setViewShapes, viewShapesRef) => {
      setViewShapes((prev) => {
        const next = prev.map((shape) => {
          if (shape.id !== id) {
            return shape;
          }

          return {
            ...shape,
            ...changes,
          };
        });

        viewShapesRef.current = next;

        return next;
      });
    },
    []
  );

  /**
   * 選択中図形を取得
   * @param {array} viewShapes - ビュー図形配列
   * @param {string} selectedId - 選択中のID
   * @returns {object|undefined} 選択中の図形
   */
  const getSelectedShape = useCallback((viewShapes, selectedId) => {
    return viewShapes.find((shape) => shape.id === selectedId);
  }, []);

  /**
   * キャンバスサイズを計算
   * @param {array} viewShapes - ビュー図形配列
   * @returns {object} 幅と高さ
   */
  const calculateCanvasSize = useCallback((viewShapes) => {
    const canvasWidth = Math.max(
      2000,
      ...viewShapes.map((shape) => shape.x + shape.width + 400)
    );

    const canvasHeight = Math.max(
      1400,
      ...viewShapes.map((shape) => shape.y + shape.height + 400)
    );

    return { canvasWidth, canvasHeight };
  }, []);

  /**
   * 削除時に選択状態をクリア
   * @param {object} setters
   */
  const clearSelectionState = useCallback((setters) => {
    const { setSelectedId, setEditingId, setInteraction } = setters;
    setSelectedId(null);
    setEditingId(null);
    setInteraction(null);
  }, []);

  /**
   * テキスト編集状態をリセット
   * @param {object} setters 
   */
  const resetTextEditingState = useCallback((setters) => {
    const { setEditingId, setDraftText } = setters;
    setEditingId(null);
    setDraftText("");
  }, []);

  return {
    updateShapeLocal,
    getSelectedShape,
    calculateCanvasSize,
    clearSelectionState,
    resetTextEditingState,
  };
}
