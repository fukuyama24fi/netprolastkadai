/**
 * ファイル操作用
 * JSON保存、コピー、ダウンロード処理
 */

import { useCallback } from "react";
import { generateFrontendCss, generateFrontendHtml } from "../utils/htmlGenerator";

/**
 * ファイル操作フック
 * @returns {object} ファイル操作関数群
 */
export function useFileOperations() {
  /**
   * JSONファイルをダウンロード
   * @param {array} viewShapes - 現在の図形配列
   * @param {string} fileName - ファイル名
   */
  const handleSaveJsonFile = useCallback((viewShapes, fileName) => {
    const saveData = {
      version: 1,
      fileName: fileName.trim() || "pikva-canvas",
      savedAt: new Date().toISOString(),
      objects: viewShapes,
    };

    const json = JSON.stringify(saveData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = `${fileName.trim() || "pikva-canvas"}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(downloadUrl);
  }, []);

  /**
   * HTMLコードを表示用に生成
   * @param {array} viewShapes - 現在の図形配列
   * @param {string} fileName - ファイル名
   * @param {function} setCodeOutput - コード出力state設定関数
   */
  const handleShowHtmlCode = useCallback(
    (viewShapes, fileName, setCodeOutput) => {
      const safeFileName = fileName.trim() || "pikva-canvas";
      const htmlCode = generateFrontendHtml(viewShapes, `${safeFileName}.css`);

      setCodeOutput({
        type: "HTML",
        content: htmlCode,
      });
    },
    []
  );

  /**
   * CSSコードを表示用に生成
   * @param {array} viewShapes - 現在の図形配列
   * @param {function} setCodeOutput - コード出力state設定関数
   */
  const handleShowCssCode = useCallback((viewShapes, setCodeOutput) => {
    const cssCode = generateFrontendCss(viewShapes);

    setCodeOutput({
      type: "CSS",
      content: cssCode,
    });
  }, []);

  /**
   * コードをクリップボードにコピー
   * @param {object} codeOutput - 出力するコード情報
   * @returns {Promise<boolean>} コピー成功の可否
   */
  const handleCopyCode = useCallback(async (codeOutput) => {
    if (!codeOutput.content) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(codeOutput.content);
      return true;
    } catch (error) {
      console.error("コピーに失敗しました:", error);
      return false;
    }
  }, []);

  return {
    handleSaveJsonFile,
    handleShowHtmlCode,
    handleShowCssCode,
    handleCopyCode,
  };
}
