// キャンバス計算用
//スマートガイド、レイヤー順序
 

import { useCallback } from "react";

const SNAP_THRESHOLD = 6;

/**
 * キャンバス計算ロジック用フック
 * @returns {object} 計算関数群
 */
export function useCanvasCalculations() {
  /**
   * スマートガイドを計算
   * @param {object} movingShape - 移動中の図形
   * @param {array} allShapes - 全図形の配列
   * @returns {object} スナップ位置とガイド情報
   */
  const calculateSmartGuides = useCallback((movingShape, allShapes) => {
    const otherShapes = allShapes.filter((shape) => shape.id !== movingShape.id);

    let snappedX = movingShape.x;
    let snappedY = movingShape.y;

    let nearestXDistance = SNAP_THRESHOLD + 1;
    let nearestYDistance = SNAP_THRESHOLD + 1;

    let verticalGuide = null;
    let horizontalGuide = null;

    // 移動中図形のX軸アライメントポイント
    const movingXPoints = [
      { value: movingShape.x, offset: 0 },
      {
        value: movingShape.x + movingShape.width / 2,
        offset: movingShape.width / 2,
      },
      {
        value: movingShape.x + movingShape.width,
        offset: movingShape.width,
      },
    ];

    // 移動中図形のY軸アライメントポイント
    const movingYPoints = [
      { value: movingShape.y, offset: 0 },
      {
        value: movingShape.y + movingShape.height / 2,
        offset: movingShape.height / 2,
      },
      {
        value: movingShape.y + movingShape.height,
        offset: movingShape.height,
      },
    ];

    // 他の図形との比較
    otherShapes.forEach((otherShape) => {
      const targetXPoints = [
        otherShape.x,
        otherShape.x + otherShape.width / 2,
        otherShape.x + otherShape.width,
      ];

      const targetYPoints = [
        otherShape.y,
        otherShape.y + otherShape.height / 2,
        otherShape.y + otherShape.height,
      ];

      // 縦方向（X軸）の整列を確認
      movingXPoints.forEach((movingPoint) => {
        targetXPoints.forEach((targetX) => {
          const distance = Math.abs(targetX - movingPoint.value);

          if (
            distance <= SNAP_THRESHOLD &&
            distance < nearestXDistance
          ) {
            nearestXDistance = distance;
            snappedX = targetX - movingPoint.offset;
            verticalGuide = targetX;
          }
        });
      });

      // 横方向（Y軸）の整列を確認
      movingYPoints.forEach((movingPoint) => {
        targetYPoints.forEach((targetY) => {
          const distance = Math.abs(targetY - movingPoint.value);

          if (
            distance <= SNAP_THRESHOLD &&
            distance < nearestYDistance
          ) {
            nearestYDistance = distance;
            snappedY = targetY - movingPoint.offset;
            horizontalGuide = targetY;
          }
        });
      });
    });

    return {
      x: snappedX,
      y: snappedY,
      guides: {
        vertical: verticalGuide === null ? [] : [verticalGuide],
        horizontal: horizontalGuide === null ? [] : [horizontalGuide],
      },
    };
  }, []);

  /**
   * レイヤー順序を計算・更新
   * @param {string} selectedId - 選択中の図形ID
   * @param {string} direction - 移動方向
   * @param {array} currentShapes - 現在の図形配列
   * @returns {object|null} 更新された図形配列と変更情報
   */
  const calculateLayerReorder = useCallback(
    (selectedId, direction, currentShapes) => {
      if (!selectedId || currentShapes.length < 2) {
        return null;
      }

      // zIndexが重複していても、元の配列順を使って安定して並べる
      const orderedShapes = currentShapes
        .map((shape, originalIndex) => {
          const parsedZIndex = Number(shape.zIndex);

          return {
            shape,
            originalIndex,
            calculatedZIndex: Number.isFinite(parsedZIndex)
              ? parsedZIndex
              : originalIndex,
          };
        })
        .sort((itemA, itemB) => {
          const zIndexDifference =
            itemA.calculatedZIndex - itemB.calculatedZIndex;

          if (zIndexDifference !== 0) {
            return zIndexDifference;
          }

          return itemA.originalIndex - itemB.originalIndex;
        })
        .map((item) => item.shape);

      const selectedIndex = orderedShapes.findIndex(
        (shape) => shape.id === selectedId
      );

      if (selectedIndex === -1) {
        return null;
      }

      const targetIndex =
        direction === "forward" ? selectedIndex + 1 : selectedIndex - 1;

      // 既に最前面または最背面の場合
      if (targetIndex < 0 || targetIndex >= orderedShapes.length) {
        return null;
      }

      // 選択図形と隣の図形を入れ替える
      const reorderedShapes = [...orderedShapes];
      [reorderedShapes[selectedIndex], reorderedShapes[targetIndex]] = [
        reorderedShapes[targetIndex],
        reorderedShapes[selectedIndex],
      ];

      // zIndexを必ず振り直す
      const zIndexById = new Map();
      reorderedShapes.forEach((shape, index) => {
        zIndexById.set(shape.id, index);
      });

      const changedShapes = [];
      const nextShapes = currentShapes.map((shape) => {
        const newZIndex = zIndexById.get(shape.id);
        const currentZIndex = Number(shape.zIndex);

        if (currentZIndex !== newZIndex) {
          changedShapes.push({
            id: shape.id,
            zIndex: newZIndex,
          });
        }

        return {
          ...shape,
          zIndex: newZIndex,
        };
      });

      return {
        nextShapes,
        changedShapes,
      };
    },
    []
  );

  return {
    calculateSmartGuides,
    calculateLayerReorder,
  };
}
