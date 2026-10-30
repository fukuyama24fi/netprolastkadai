import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { toBlob } from "html-to-image";

import { useCanvasSocket } from "./services/UseCanvasSocket";//サーバ通信
import {
  useCanvasCalculations,//重なり
  useCanvasState,//巣系の状態
  useFileOperations,//ファイルの生成
  useInteractionHandlers,//ドラッグ（回転）
} from "./hooks";
import { generateFrontendCss, generateFrontendHtml } from "./utils/htmlGenerator";
import { useAiChat } from "./hooks/useAiChat";
import AiChatPanel from "./components/AiChatPanel";
import HistoryComments from "./components/HistoryComments";
import "./App.css";

// ========== 定数 ==========

const TYPE_LABELS = {
  rect: "四角形",
  circle: "円",
  triangle: "三角形",
  text: "テキスト",

  // 新しい図形
  rounded: "角丸四角形",
  diamond: "ひし形",
  pentagon: "五角形",
  hexagon: "六角形",
  star: "星形",
  arrow: "矢印",
};
// 図形同士が6px以内まで近づいたら、ピタッと揃えるための距離。
// 現在このファイルでは直接使わず、別Hookへ移動済みの可能性があります。
const SNAP_THRESHOLD = 6;
// スマートガイドが1本も出ていない状態。
// verticalは縦線、horizontalは横線です。
const EMPTY_SMART_GUIDES = { vertical: [], horizontal: [] };
// キャンバスの初期幅・初期高さ・余白。
// 現在はcalculateCanvasSize側で管理しているなら未使用です。
const DEFAULT_CANVAS_WIDTH = 2000;
const DEFAULT_CANVAS_HEIGHT = 1400;
const CANVAS_PADDING = 400;
// 図形を小さくしても、幅・高さが30px未満にならないようにする。
const MIN_SHAPE_SIZE = 30;
// 文字サイズは8px〜200pxの範囲に制限する。
const MAX_FONT_SIZE = 200;
const MIN_FONT_SIZE = 8;
// Shiftを押しながら回転したとき、15度単位でカクッと止める。
const ROTATION_SNAP_ANGLE = 15;
// マウスが画面端から80px以内へ来たら、自動スクロールを開始。
// 1回のマウス移動につき24pxスクロールする。
const AUTO_SCROLL_EDGE_SIZE = 80;
const AUTO_SCROLL_SPEED = 24;
// キャンバスの拡大縮小設定（既存UIに合わせて復元）
const MIN_CANVAS_SCALE = 0.25;
const DEFAULT_CANVAS_SCALE = 0.55;
const ZOOM_SLIDER_MIN = 25;
const ZOOM_SLIDER_MAX = 150;
const HISTORY_PAGE_SIZE = 200;

// 見た目の縮小倍率を計算してドラッグ座標を補正する
const getCanvasScale = (canvas) => {
  if (!canvas || !canvas.offsetWidth) return 1;
  return canvas.getBoundingClientRect().width / canvas.offsetWidth;
};

// ========== コンポーネント ==========

const App = () => {
  // ========== Hooks から取得 ==========
  const {
    shapes,// サーバーから届いた「正式な図形データ」
    history,
    hasOlderHistory, // まだ古い履歴がサーバーにあるか
    isLoadingOlderHistory, // 古い履歴を読み込み中か
    loadOlderHistory, // さらに古い履歴を200件読み込む
    userName,
    setUserName,
    addShape,
    updateRect,
    deleteRect,
    clearCanvas,
    undo,
    redo,
    jumpToHistory,
    importCanvas,
    exportedHtml,
    exportCode,
  } = useCanvasSocket();

  // AIチャット（useCanvasSocket の後に呼ぶ。会話はタブを切り替えても残る）
  const aiChat = useAiChat();
  // 右サイドバーのタブ（"history" または "ai"）
  const [sidebarTab, setSidebarTab] = useState("history");

  const { calculateSmartGuides, calculateLayerReorder } =
    useCanvasCalculations();//図形をほかの図形の端・中央へ吸着させる位置を計算.  図形を1つ前・1つ後ろへ動かした結果を計算
  const { updateShapeLocal, getSelectedShape, calculateCanvasSize, clearSelectionState, resetTextEditingState } =
    useCanvasState();// 図形・選択状態などの「画面データ管理
  const { handleSaveJsonFile, handleShowHtmlCode, handleShowCssCode, handleCopyCode } =
    useFileOperations();//JSON保存、HTML/CSS生成、コピー
  const { startDrag, startResize, startRotate, startTextEditing } =
    useInteractionHandlers();//ドラッグ・リサイズ・回転・文字編集の開始

  // ========== State ==========
  //画面で使う、変化する値を入れる箱
  const [viewShapes, setViewShapes] = useState([]);// 現在選択中の図形ID
  const [selectedId, setSelectedId] = useState(null);// 現在の操作情報。
  const [interaction, setInteraction] = useState(null);// 図形整列用の補助線情報。
  const [smartGuides, setSmartGuides] = useState(EMPTY_SMART_GUIDES); // 現在テキスト編集中の図形ID
  const [editingId, setEditingId] = useState(null); // textareaへ入力中の、まだ確定していない文字。
  const [draftText, setDraftText] = useState("");
  const [fileName, setFileName] = useState("pikva-canvas");// 保存・出力時に使うファイル名。
　const [pngExporting, setPngExporting] = useState(false);// PNG画像を出力しているかどうか
  const [codeOutput, setCodeOutput] = useState({ // 画面へ表示するHTMLまたはCSSコード。
    type: "",
    content: "",
  });

  // ========== Refs ==========
  //useRef      = 画面を更新せずに使えるメモ帳
  const canvasRef = useRef(null);
  // JSONファイルを選択するinputを操作する
const openFileInputRef = useRef(null);
  const mainRef = useRef(null);
  const historyEndRef = useRef(null);
  const historyScrollRef = useRef(null);
  const prevHistoryInfoRef = useRef(null);
  const viewShapesRef = useRef([]);
  const interactionRef = useRef(null);
  const didMoveRef = useRef(false);
  const cancelTextEditRef = useRef(false);

  // ========== Effects ==========

  // interaction参照を最新に保つ
   
  useEffect(() => {//何かが変わったときに、自動的に処理を実行します。
    interactionRef.current = interaction;
  }, [interaction]);//監視対象

  // サーバーから受け取った図形を画面へ反映
   
  useEffect(() => {
    if (interactionRef.current) {
      return;
    }

    setViewShapes(shapes);
    viewShapesRef.current = shapes;
  }, [shapes]);

  // 履歴の追加方向に応じてスクロール位置を保持する
  useLayoutEffect(() => {
    const scroller = historyScrollRef.current;
    const prev = prevHistoryInfoRef.current;
    const firstId = history[0]?.id;
    const lastId = history[history.length - 1]?.id;
    prevHistoryInfoRef.current = {
      firstId,
      lastId,
      scrollHeight: scroller?.scrollHeight ?? 0,
    };
    if (!scroller) return;
    if (!prev || prev.lastId === undefined) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    if (prev.lastId === lastId) {
      if (prev.firstId !== firstId && prev.scrollHeight > 0) {
        scroller.scrollTop += scroller.scrollHeight - prev.scrollHeight;
      }
      return;
    }
    const distanceFromBottom =
      prev.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom > 80) return;
    historyEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [history]);

  // 編集履歴を一番上の近くまでスクロールしたら、さらに古い履歴を読み込む
  const handleHistoryScroll = useCallback(
    (event) => {
      if (event.currentTarget.scrollTop < 40) {
        loadOlderHistory();
      }
    },
    [loadOlderHistory]
  );

  // 履歴タブを開いたときは、アニメーションせずに最初から一番下（最新の履歴）を表示する
  // useLayoutEffect は画面に描かれる前に動くので、上から流れていく様子が見えない
  useLayoutEffect(() => {
    const scroller = historyScrollRef.current;
    if (sidebarTab === "history" && scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      // 古い履歴を付け足すときの位置合わせに使う高さも、今の高さにしておく
      if (prevHistoryInfoRef.current) {
        prevHistoryInfoRef.current.scrollHeight = scroller.scrollHeight;
      }
    }
  }, [sidebarTab]);

  /**
   * サーバーからHTMLが返ってきたらダウンロード
   */
  useEffect(() => {
    if (!exportedHtml) {
      return;
    }

    const blob = new Blob([exportedHtml], { type: "text/html" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = `${fileName.trim() || "pikva-export"}.html`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(downloadUrl);
  }, [exportedHtml, fileName]);

  // Delete・Backspaceキーで削除
   
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.key !== "Delete" &&
        event.key !== "Backspace"
      ) {
        return;
      }

      const tagName = document.activeElement?.tagName;

      if (tagName === "INPUT" || tagName === "TEXTAREA") {
        return;
      }

      if (!selectedId) {
        return;
      }

      event.preventDefault();
      handleDeleteSelected();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedId]);

  // 移動・リサイズ・回転中のマウス操作
   
  useEffect(() => {
    if (!interaction) {
      return;
    }

    const handleMouseMove = (event) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      didMoveRef.current = true;

      if (interaction.mode !== "rotate") {
        autoScrollMain(event);
      }

      const canvasRect = canvas.getBoundingClientRect();

      // drag   = 移動
      // resize = サイズ変更
      // rotate = 回転
      switch (interaction.mode) {
        case "drag":
          handleDragMove(event, canvasRect);
          break;

        case "resize":
          handleResizeMove(event);
          break;

        case "rotate":
          handleRotateMove(event);
          break;

        default:
          break;
      }
    };

    //マウスを離したら操作を確定します。
    const handleMouseUp = () => {
      setSmartGuides(EMPTY_SMART_GUIDES);
      if (!didMoveRef.current) {
        setInteraction(null);
        return;
      }

      const targetShape = viewShapesRef.current.find(
        (shape) => shape.id === interaction.id
      );

      if (!targetShape) {
        setInteraction(null);
        return;
      }

      if (interaction.mode === "drag") {
        updateRect(targetShape.id, {
          x: targetShape.x,
          y: targetShape.y,
        });
      }

      if (interaction.mode === "resize") {
        updateRect(targetShape.id, {
          width: targetShape.width,
          height: targetShape.height,
        });
      }

      if (interaction.mode === "rotate") {
        updateRect(targetShape.id, {
          rotation: targetShape.rotation || 0,
        });
      }

      setInteraction(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [interaction]);

  // ========== 計算済み値 ==========

  const selectedShape = getSelectedShape(viewShapes, selectedId);// viewShapesの中から、selectedIdと同じIDの図形を探す。
  const isSelectedText = selectedShape?.type === "text";
  const { canvasWidth, canvasHeight } = calculateCanvasSize(viewShapes);

  // ========== キャンバスの縮小表示 ==========
  const [fitScale, setFitScale] = useState(1);
  const [manualScale, setManualScale] = useState(DEFAULT_CANVAS_SCALE);
  const canvasScale = manualScale ?? fitScale;

  useEffect(() => {
    const main = mainRef.current;
    if (!main || interaction) return;

    const updateScale = () => {
      const style = window.getComputedStyle(main);
      const availableWidth = main.clientWidth
        - parseFloat(style.paddingLeft)
        - parseFloat(style.paddingRight) - 2;
      const availableHeight = main.clientHeight
        - parseFloat(style.paddingTop)
        - parseFloat(style.paddingBottom) - 2;
      const nextScale = Math.max(
        MIN_CANVAS_SCALE,
        Math.min(1, availableWidth / canvasWidth, availableHeight / canvasHeight)
      );
      setFitScale(nextScale);
    };

    updateScale();
    // サイズ変更に追従（ブラウザ未対応時でも初期表示は可能）
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateScale);
    observer.observe(main);
    return () => observer.disconnect();
  }, [canvasWidth, canvasHeight, interaction]);

  // ========== 内部関数 ==========

  // ドラッグ移動の処理
   
  const handleDragMove = useCallback(
    (event, canvasRect) => {
      // マウスの位置（画面上の px）を縮小率で割って、キャンバス上の座標に直す
      // 縮小率で割ると小数になるので整数に丸める（DBの列が整数でも保存できるように）
      const scale = getCanvasScale(canvasRef.current);
      const newX = Math.round((event.clientX - canvasRect.left) / scale - interaction.offsetX);
      const newY = Math.round((event.clientY - canvasRect.top) / scale - interaction.offsetY);

      const movingShape = viewShapesRef.current.find(
        (shape) => shape.id === interaction.id
      );

      if (!movingShape) {
        return;
      }
// Shiftを押している間はスマートガイドを無効にし、
      // マウスどおりの位置へ自由に動かします。
      if (event.shiftKey) {
        setSmartGuides(EMPTY_SMART_GUIDES);
        updateShapeLocal(interaction.id, { x: newX, y: newY }, setViewShapes, viewShapesRef);
        return;
      }
// Shiftを押していない場合は、
      // ほかの図形の端・中央へ吸着する位置を計算します。
      const snapResult = calculateSmartGuides(
        { ...movingShape, x: newX, y: newY },//中身をばらしてコピーする
        viewShapesRef.current
      );

      setSmartGuides(snapResult.guides);
      updateShapeLocal(interaction.id, { x: snapResult.x, y: snapResult.y }, setViewShapes, viewShapesRef);
    },
    [interaction, calculateSmartGuides, updateShapeLocal]
  );

  // リサイズ移動の処理
   
  const handleResizeMove = useCallback((event) => {
    setSmartGuides(EMPTY_SMART_GUIDES);
    // マウスが動いた距離（画面上の px）を縮小率で割って、キャンバス上の大きさに直す
    // 縮小率で割ると小数になるので整数に丸める（DBの列が整数でも保存できるように）
    const scale = getCanvasScale(canvasRef.current);
    const diffX = Math.round((event.clientX - interaction.startX) / scale);
    const diffY = Math.round((event.clientY - interaction.startY) / scale);

    const newWidth = Math.max(
      MIN_SHAPE_SIZE,
      interaction.startWidth + diffX
    );

    const newHeight = Math.max(
      MIN_SHAPE_SIZE,
      interaction.startHeight + diffY
    );

    updateShapeLocal(
      interaction.id,
      { width: newWidth, height: newHeight },
      setViewShapes,
      viewShapesRef
    );
  }, [interaction, updateShapeLocal]);

  // 回転移動の処理/ラジアン
   
  const handleRotateMove = useCallback((event) => {
    setSmartGuides(EMPTY_SMART_GUIDES);
    const currentPointerAngle =
      (Math.atan2(
        event.clientY - interaction.centerY,
        event.clientX - interaction.centerX
      ) *
        180) /
      Math.PI;

    const angleDifference =
      currentPointerAngle - interaction.startPointerAngle;

    let newRotation = interaction.startRotation + angleDifference;
 // Shiftを押している場合は、15度単位に丸めます。
    // 例: 17度 → 15度、23度 → 30度
    if (event.shiftKey) {
      newRotation = Math.round(newRotation / ROTATION_SNAP_ANGLE) * ROTATION_SNAP_ANGLE;
    }

    newRotation = ((newRotation % 360) + 360) % 360;

    updateShapeLocal(
      interaction.id,
      { rotation: Math.round(newRotation) },
      setViewShapes,
      viewShapesRef
    );
  }, [interaction, updateShapeLocal]);

  // ドラッグ・リサイズ時の画面端スクロール
   
  const autoScrollMain = useCallback((event) => {
    const main = mainRef.current;

    if (!main) {
      return;
    }

    const rect = main.getBoundingClientRect();

    if (event.clientX > rect.right - AUTO_SCROLL_EDGE_SIZE) {
      main.scrollLeft += AUTO_SCROLL_SPEED;
    }

    if (event.clientX < rect.left + AUTO_SCROLL_EDGE_SIZE) {
      main.scrollLeft -= AUTO_SCROLL_SPEED;
    }

    if (event.clientY > rect.bottom - AUTO_SCROLL_EDGE_SIZE) {
      main.scrollTop += AUTO_SCROLL_SPEED;
    }

    if (event.clientY < rect.top + AUTO_SCROLL_EDGE_SIZE) {
      main.scrollTop -= AUTO_SCROLL_SPEED;
    }
  }, []);

  // 図形追加//サーバーへ円の追加を依頼
   
  const handleAddShape = useCallback(
    (type) => {
      addShape(type);
    },
    [addShape]
  );

  // キャンバスクリア
   
  const handleClearCanvas = useCallback(() => {
    clearCanvas();
    clearSelectionState({ setSelectedId, setEditingId, setInteraction });
  }, [clearCanvas, clearSelectionState]);

  // 選択中図形削除
   
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }

    const targetId = selectedId;

    setViewShapes((prev) => {
      const next = prev.filter((shape) => shape.id !== targetId);
      viewShapesRef.current = next;
      return next;
    });

    clearSelectionState({ setSelectedId, setEditingId, setInteraction });
    deleteRect(targetId);
  }, [selectedId, deleteRect, clearSelectionState]);

  // 色変更
   
  const handleColorChange = useCallback(
    (event) => {
      const fill = event.target.value;
      if (!selectedId) {
        return;
      }
      updateShapeLocal(selectedId, { fill }, setViewShapes, viewShapesRef);
      updateRect(selectedId, { fill });
    },
    [selectedId, updateShapeLocal, updateRect]
  );

  // テキスト編集終了・保存
   
  const finishTextEditing = useCallback(
    (shapeId) => {
      if (cancelTextEditRef.current) {
        cancelTextEditRef.current = false;
        setEditingId(null);
        return;
      }

      updateShapeLocal(shapeId, { text: draftText }, setViewShapes, viewShapesRef);
      updateRect(shapeId, { text: draftText });
      setEditingId(null);
    },
    [draftText, updateShapeLocal, updateRect]
  );

  // テキスト編集中のキー
   
  const handleTextKeyDown = useCallback((event) => {
    if (event.key === "Enter" && !event.shiftKey) {//   編集を確定するため、textareaからフォーカスを外す
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {// キャンセル印を付けて、textareaからフォーカスを外す
      event.preventDefault();
      cancelTextEditRef.current = true;
      event.currentTarget.blur();
    }
  }, []);

  // Undo
   
  const handleUndo = useCallback(() => {
    clearSelectionState({ setSelectedId, setEditingId, setInteraction });
    undo();
  }, [undo, clearSelectionState]);

  // Redo 
   
  const handleRedo = useCallback(() => {
    clearSelectionState({ setSelectedId, setEditingId, setInteraction });
    redo();
  }, [redo, clearSelectionState]);

  // 履歴ジャンプ
   
  const handleHistoryClick = useCallback(
    (historyItem) => {
      if (interaction) {
        console.warn("操作中は履歴ジャンプできません");
        return;
      }

      clearSelectionState({ setSelectedId, setEditingId, setInteraction });
      jumpToHistory(historyItem.id);
    },
    [interaction, jumpToHistory, clearSelectionState]
  );

  // 文字サイズ変更
   
  const handleFontSizeChange = useCallback(
    (event) => {
      const fontSize = Number(event.target.value);

      if (!Number.isFinite(fontSize)) {
        return;
      }

      if (!selectedId) {
        return;
      }

      const clampedSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fontSize));
      updateShapeLocal(selectedId, { fontSize: clampedSize }, setViewShapes, viewShapesRef);
      updateRect(selectedId, { fontSize: clampedSize });
    },
    [selectedId, updateShapeLocal, updateRect]
  );

  // 太字
   
  const toggleBold = useCallback(() => {
    if (!selectedShape) return;

    if (!selectedId) {
      return;
    }

    const newWeight = selectedShape.fontWeight === "bold" ? "normal" : "bold";
    updateShapeLocal(selectedId, { fontWeight: newWeight }, setViewShapes, viewShapesRef);
    updateRect(selectedId, { fontWeight: newWeight });
  }, [selectedId, selectedShape, updateShapeLocal, updateRect]);

  // 斜体
   
  const toggleItalic = useCallback(() => {
    if (!selectedShape) return;

    if (!selectedId) {
      return;
    }

    const newStyle = selectedShape.fontStyle === "italic" ? "normal" : "italic";
    updateShapeLocal(selectedId, { fontStyle: newStyle }, setViewShapes, viewShapesRef);
    updateRect(selectedId, { fontStyle: newStyle });
  }, [selectedId, selectedShape, updateShapeLocal, updateRect]);

  // 大文字表示
   
  const toggleUppercase = useCallback(() => {
    if (!selectedShape) return;

    if (!selectedId) {
      return;
    }

    const newTransform =
      selectedShape.textTransform === "uppercase" ? "none" : "uppercase";
    updateShapeLocal(selectedId, { textTransform: newTransform }, setViewShapes, viewShapesRef);
    updateRect(selectedId, { textTransform: newTransform });
  }, [selectedId, selectedShape, updateShapeLocal, updateRect]);

  // 回転値をサーバーへ保存
   
  const saveSelectedRotation = useCallback(() => {
    if (!selectedId) {
      return;
    }

    const targetShape = viewShapesRef.current.find(
      (shape) => shape.id === selectedId
    );

    if (!targetShape) {
      return;
    }

    updateRect(targetShape.id, {
      rotation: targetShape.rotation || 0,
    });
  }, [selectedId, updateRect]);

  // 選択図形をサーバーとローカルで更新
   
  const updateSelectedShape = useCallback(
    (changes) => {
      if (!selectedId) {
        return;
      }
      updateShapeLocal(selectedId, changes, setViewShapes, viewShapesRef);
      updateRect(selectedId, changes);
    },
    [selectedId, updateShapeLocal, updateRect]
  );

  // 図形の重なり順移動
   
  const moveSelectedLayer = useCallback(
    (direction) => {
      const result = calculateLayerReorder(
        selectedId,
        direction,
        viewShapesRef.current
      );

      if (!result) {
        return;
      }

      const { nextShapes, changedShapes } = result;

      setViewShapes(nextShapes);
      viewShapesRef.current = nextShapes;

      changedShapes.forEach(({ id, zIndex }) => {
        updateRect(id, { zIndex });
      });
    },
    [selectedId, calculateLayerReorder, updateRect]
  );

  // レイヤーを前へ
   
  const bringForward = useCallback(() => {
    moveSelectedLayer("forward");
  }, [moveSelectedLayer]);

  //レイヤーを後ろへ
   
  const sendBackward = useCallback(() => {
    moveSelectedLayer("backward");
  }, [moveSelectedLayer]);

  // HTML表示viewShapes

  const handleClickShowHtml = useCallback(() => {
    handleShowHtmlCode(viewShapes, fileName, setCodeOutput);
  }, [viewShapes, fileName, handleShowHtmlCode]);

  // CSS表示
   
  const handleClickShowCss = useCallback(() => {
    handleShowCssCode(viewShapes, setCodeOutput);
  }, [viewShapes, handleShowCssCode]);

  // コード コピー
   
  const handleClickCopyCode = useCallback(async () => {
    const success = await handleCopyCode(codeOutput);
    if (success) {
      window.alert(`${codeOutput.type}コードをコピーしました`);
    } else {
      window.alert("コードをコピーできませんでした");
    }
  }, [codeOutput.type, codeOutput.content, handleCopyCode]);

  // JSONファイル保存
   
  const handleClickSaveFile = useCallback(() => {
    handleSaveJsonFile(viewShapes, fileName);
  }, [viewShapes, fileName, handleSaveJsonFile]);

  // ========================================
// PNG画像出力機能
// ========================================

const handleClickExportPng = useCallback(async () => {

  // 現在のキャンバスを取得
  const canvas = canvasRef.current;

  if (!canvas || pngExporting) {
    return;
  }

  // テキスト編集中は出力しない
  if (editingId !== null) {
    window.alert(
      "テキストの編集を確定してからPNG出力してください。"
    );
    return;
  }

  // ドラッグ・回転・リサイズ中は出力しない
  if (interactionRef.current) {
    window.alert(
      "図形の操作が終わってからPNG出力してください。"
    );
    return;
  }

  // 出力開始
  setPngExporting(true);

  // 編集用の選択枠を一時的に非表示
  canvas.classList.add("png-exporting");

  try {

    // フォントの読み込みを待つ
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    // キャンバス全体をPNGに変換
    const blob = await toBlob(canvas, {

      // PNGの背景色
      backgroundColor: "#ffffff",

      // キャンバス全体のサイズ
      width: Math.ceil(canvasWidth),
      height: Math.ceil(canvasHeight),

      // 表示倍率に関係なく元の解像度で保存
      pixelRatio: 1,

      // 画面上の縮小・拡大を解除して画像化
      style: {
        transform: "none",
        transformOrigin: "top left",
        border: "none",
      },

      // 編集用の部品はPNGに含めない
      filter: (element) => {

        if (!element.classList) {
          return true;
        }

        const excludedClasses = [
          "smart-guide",
          "resize-handle",
          "rotate-handle",
          "shape-measurement",
        ];

        return !excludedClasses.some(
          (className) =>
            element.classList.contains(className)
        );
      },
    });

    // 画像生成失敗
    if (!blob) {
      throw new Error("PNG画像を生成できませんでした。");
    }

    // ファイル名を取得
    const safeFileName = (
      fileName.trim() || "pikva-canvas"
    )
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\.+$/, "")
      .slice(0, 100) || "pikva-canvas";

    // PNG画像のダウンロードURLを作成
    const downloadUrl = URL.createObjectURL(blob);

    // ダウンロード用のリンク
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = `${safeFileName}.png`;

    document.body.appendChild(link);

    // ダウンロード実行
    link.click();

    // リンク削除
    link.remove();

    // ダウンロード開始後にURLを解放
    setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
    }, 30000);

    console.log("PNG出力成功:", link.download);

  } catch (error) {

    console.error("PNG出力エラー:", error);

    window.alert(
      "PNG画像の出力に失敗しました。\n" +
      (error?.message || "不明なエラー")
    );

  } finally {

    // 編集用の選択枠を元に戻す
    canvas.classList.remove("png-exporting");

    // 出力終了
    setPngExporting(false);
  }

}, [
  canvasWidth,
  canvasHeight,
  fileName,
  editingId,
  pngExporting,
]);

  // ========================================
// JSONファイル読み込み機能
// ========================================

// 「開く」ボタンを押したとき
const handleClickOpenFile = () => {
  openFileInputRef.current?.click();
};

// JSONファイルを選択したとき
const handleOpenFileChange = async (event) => {
  const file = event.target.files?.[0];

  // 同じファイルを再選択できるようにする
  event.target.value = "";

  if (!file) {
    return;
  }

  // ファイルサイズ制限（5MB）
  if (file.size > 5 * 1024 * 1024) {
    window.alert("ファイルサイズが大きすぎます。");
    return;
  }

  try {
    // ファイルを文字列として読み込む
    const text = await file.text();

    // JSONをJavaScriptオブジェクトに変換
    const data = JSON.parse(text);

    // 保存形式を確認
    if (
      !data ||
      data.version !== 1 ||
      !Array.isArray(data.objects)
    ) {
      throw new Error(
        "Pikvaで保存したJSONファイルではありません。"
      );
    }

    // 図形の数を確認
    if (data.objects.length > 200) {
      throw new Error(
        "一度に読み込める図形は200個までです。"
      );
    }

    // 現在のキャンバスを上書きしてよいか確認
    const confirmed = window.confirm(
      "現在の共通キャンバスを読み込んだ内容で置き換えます。\n" +
      "この変更は他の参加者にも反映されます。\n\n" +
      "事前に保存しましたか？\n\n" +
      "読み込みを続行しますか？"
    );

    if (!confirmed) {
      return;
    }

    // Socket.IO経由でサーバーへ送信
    const result = await importCanvas(data.objects);

    // ファイル名を変更
    const loadedName =
      typeof data.fileName === "string" &&
      data.fileName.trim()
        ? data.fileName
        : file.name.replace(/\.json$/i, "");

    setFileName(loadedName);

    // 選択状態を解除
    clearSelectionState({
      setSelectedId,
      setEditingId,
      setInteraction,
    });

    window.alert(
      `${result.count}個の図形を読み込みました！`
    );

  } catch (error) {
    console.error("JSON読み込みエラー:", error);

    window.alert(
      "ファイルを開けませんでした。\n" +
      error.message
    );
  }
};

  //履歴の図形名を日本語へ変換
   
  const formatObjectLabel = useCallback((historyItem) => {
    const type =
      historyItem.after?.type || historyItem.before?.type;

    if (type) {
      return TYPE_LABELS[type] || type;
    }

    return historyItem.objectId
      ? historyItem.objectId.slice(0, 8)
      : "";
  }, []);

  // ========== HTML ==========

  return (
    <div className="app">
      {/* ===== 画面上部のヘッダー =====
          ロゴ、ファイル名、新規、保存、出力ボタンを置きます。 */}
      <header className="app-header">
        <strong className="app-header-title">
          <img src="/pictuer/2aikon.png" alt="Pikva Icon" />
          Pikva
        </strong>

        {/* ファイル名入力欄。
            valueは現在値、onChangeは入力されたときの処理です。 */}
        <input
          type="text"
          className="file-name-input"
          value={fileName}
          onChange={(event) => {
            setFileName(event.target.value);
          }}
          placeholder="ファイル名"
        />

        <button type="button" onClick={handleClearCanvas}>
          新規
        </button>

        <button type="button" onClick={handleClickSaveFile}>
          保存
        </button>

        {/* JSONファイルを選択する隠しinput */}
        <input
          type="file"
          accept=".json,application/json"
          ref={openFileInputRef}
          onChange={handleOpenFileChange}
          style={{ display: "none" }}
          />

          {/* ファイルを開くボタン */}
        <button type="button" onClick={handleClickOpenFile}>
          開く
        </button>
        

        {/* PNG画像出力ボタン */}
        <button
          type="button"
          onClick={handleClickExportPng}
          disabled={pngExporting}
        >
          {pngExporting ? "PNG作成中..." : "PNG出力"}
        </button>

        <button type="button" onClick={handleClickShowHtml}>
          HTML出力
        </button>

        <button type="button" onClick={handleClickShowCss}>
          CSS出力
        </button>
      </header>

      {/* codeOutput.contentに文字が入っているときだけ、
          HTML/CSSコード表示パネルを出します。 */}
      {codeOutput.content && (
        <section className="code-output-panel">
          <div className="code-output-header">
            <strong>{codeOutput.type}コード</strong>

            <div>
              <button type="button" onClick={handleClickCopyCode}>
                コピー
              </button>

              <button
                type="button"
                onClick={() => {
                  setCodeOutput({
                    type: "",
                    content: "",
                  });
                }}
              >
                閉じる
              </button>
            </div>
          </div>

          {/* readOnlyなので、ここではコードを表示するだけで編集できません。 */}
          <textarea
            className="code-output-textarea"
            value={codeOutput.content}
            readOnly
            spellCheck={false}
          />
        </section>
      )}

      {/* ===== ヘッダーより下の本体 =====
          左: ツール
          中央: キャンバス
          右: 編集履歴
      */}
      <div className="app-body">
        {/* ===== 左側のツール欄 ===== */}
        <aside className="tool">
          <h1>TOOL</h1>

          <div className="history-buttons">
            <button
              type="button"
              className="icon-button"
              onClick={handleUndo}
              title="Undo"
            >
              ↶
            </button>

            <button
              type="button"
              className="icon-button"
              onClick={handleRedo}
              title="Redo"
            >
              ↷
            </button>
          </div>

          <div className="shape-buttons">
            <button
              type="button"
              onClick={() =>
                handleAddShape("rect")
              }
            >
              四角形を追加
            </button>

            <button
              type="button"
              onClick={() =>
                handleAddShape("circle")
              }
            >
              円を追加
            </button>

            <button
              type="button"
              onClick={() =>
                handleAddShape("triangle")
              }
            >
              三角形を追加
            </button>


{[
  ["rounded", "▢ 角丸四角形"],
  ["diamond", "◆ ひし形"],
  ["pentagon", "⬟ 五角形"],
  ["hexagon", "⬢ 六角形"],
  ["star", "★ 星形"],
  ["arrow", "➜ 矢印"],
].map(([type, label]) => (
  <button
    key={type}
    type="button"
    onClick={() => handleAddShape(type)}
  >
    {label}
  </button>
))}

            <button
              type="button"
              onClick={() =>
                handleAddShape("text")
              }
            >
              テキストを追加
            </button>
          </div>

          {/* 図形を選択しているときだけ、回転スライダーを表示します。 */}
          {selectedShape && (
            <label className="rotation-tool">
              回転

              <input
                type="range"
                min="0"
                max="359"
                value={Math.round(
                  selectedShape.rotation || 0
                )}
                onChange={(event) => {
                  // スライダーを動かしている間は画面だけ更新します。
                  if (!selectedId) {
                    return;
                  }

                  updateShapeLocal(
                    selectedId,
                    {
                      rotation: Number(
                        event.target.value
                      ),
                    },
                    setViewShapes,
                    viewShapesRef
                  );
                }}
                onPointerUp={
                  // マウス・指を離したときにサーバーへ正式保存します。
                  saveSelectedRotation
                }
                onBlur={
                  saveSelectedRotation
                }
              />

              <span>
                {Math.round(
                  selectedShape.rotation || 0
                )}
                °
              </span>
            </label>
          )}

          {/* 選択中の図形を1つ前・1つ後ろへ移動するボタンです。 */}
          {selectedShape && (
            <div className="layer-tools">
              <span>重なり順</span>

              <div className="layer-buttons">
                <button
                  type="button"
                  onClick={sendBackward}
                  title="選択中の図形を1つ後ろへ移動"
                >
                  ↓ 後ろへ
                </button>

                <button
                  type="button"
                  onClick={bringForward}
                  title="選択中の図形を1つ前へ移動"
                >
                  ↑ 前へ
                </button>
              </div>
            </div>
          )}

          <label className="color-tool">
            色

            <input
              type="color"
              value={
                selectedShape?.fill || "#4f8cff"
              }
              onChange={
                handleColorChange
              }
            />
          </label>

          {/* 選択中図形がテキストの場合だけ、
              文字サイズ・太字・斜体・大文字ボタンを表示します。 */}
          {isSelectedText && (
            <div className="text-format-tools">
              <label>
                文字サイズ

                <input
                  type="number"
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
                  value={
                    selectedShape
                      ?.fontSize || 24
                  }
                  onChange={
                    handleFontSizeChange
                  }
                />
              </label>

              <div className="text-format-buttons">
                <button
                  type="button"
                  className={
                    selectedShape
                      ?.fontWeight ===
                      "bold"
                      ? "active"
                      : ""
                  }
                  onClick={toggleBold}
                  title="太字"
                >
                  B
                </button>

                <button
                  type="button"
                  className={
                    selectedShape
                      ?.fontStyle ===
                      "italic"
                      ? "active"
                      : ""
                  }
                  onClick={toggleItalic}
                  title="斜体"
                >
                  <i>I</i>
                </button>

                <button
                  type="button"
                  className={
                    selectedShape
                      ?.textTransform ===
                      "uppercase"
                      ? "active"
                      : ""
                  }
                  onClick={
                    toggleUppercase
                  }
                  title="大文字表示"
                >
                  AA
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            className="delete-button-main"
            onClick={
              handleDeleteSelected
            }
            disabled={!selectedId}
          >
            選択中を削除
          </button>

          <button
            type="button"
            onClick={handleClearCanvas}
          >
            全て消去
          </button>
        </aside>

        {/* キャンバスと倍率変更バーをまとめる */}
        <div className="canvas-area">
        <main
          ref={mainRef}
          className="main"
        >
          {/* CSS transform で縮めたキャンバスの表示領域 */}
          <div
            className="canvas-scaler"
            style={{
              width: `${canvasWidth * canvasScale + 2}px`,
              height: `${canvasHeight * canvasScale + 2}px`,
            }}
          >
          <div
            ref={canvasRef}
            className="canvas"
            style={{
              width: `${canvasWidth}px`,
              height: `${canvasHeight}px`,
              // キャンバス全体を左上を基準に縮小する（図形の座標はそのまま）
              transform: `scale(${canvasScale})`,
              transformOrigin: "top left",
            }}
            onMouseDown={(event) => {
              // キャンバスの空白部分を押したときだけ選択解除します。
              // 図形を押した場合はevent.targetとcurrentTargetが異なります。
              if (
                event.target ===
                event.currentTarget
              ) {
                setSelectedId(null);
                setEditingId(null);
              }
            }}
          >
            {/* vertical配列に入ったX座標ごとに縦ガイド線を作ります。 */}
            {smartGuides.vertical.map((guideX) => (
              <div
                key={`vertical-${guideX}`}
                className="smart-guide smart-guide-vertical"
                style={{
                  left: `${guideX}px`,
                }}
              />
            ))}

            {/* horizontal配列に入ったY座標ごとに横ガイド線を作ります。 */}
            {smartGuides.horizontal.map((guideY) => (
              <div
                key={`horizontal-${guideY}`}
                className="smart-guide smart-guide-horizontal"
                style={{
                  top: `${guideY}px`,
                }}
              />
            ))}

            {/* viewShapesの図形数だけ、図形用divを繰り返し作ります。 */}
            {viewShapes.map((shape, shapeIndex) => {
              // この図形のIDとselectedIdが同じなら選択中。
              const isSelected =
                shape.id === selectedId;

              const shapeType =
                shape.type || "rect";

              const isText =
                shapeType === "text";

              const isEditing =
                editingId === shape.id;

              return (
                /*
                 * 1個の図形を表すdivです。
                 * classNameの例: "shape circle selected"
                 */
                <div
                  key={shape.id}
                  className={[
                    "shape",
                    shapeType,
                    isSelected
                      ? "selected"
                      : "",
                    isEditing
                      ? "editing"
                      : "",
                  ].join(" ")}
                  onMouseDown={(
                    event
                  ) => {
                    // 図形を押したらドラッグ開始。
                    // ただし文字編集中はドラッグさせません。
                    if (isEditing) {
                      event.stopPropagation();
                      return;
                    }

                    startDrag(event, shape, {
                      canvasRef,
                      setInteraction,
                      setSelectedId,
                      setEditingId,
                    });
                  }}
                  onDoubleClick={(
                    event
                  ) => {
                    // テキスト図形をダブルクリックすると文字編集を開始します。
                    startTextEditing(
                      event,
                      shape,
                      {
                        setSelectedId,
                        setInteraction,
                        setDraftText,
                        setEditingId,
                      }
                    );
                  }}
                  style={{
                    // 図形ごとに違う位置・大きさ・回転・重なり順を
                    // Reactのstyle属性で直接設定
                    left: `${shape.x}px`,
                    top: `${shape.y}px`,
                    width: `${shape.width}px`,
                    height: `${shape.height}px`,

                    transform: `rotate(${shape.rotation || 0
                      }deg)`,

                    transformOrigin:
                      "center center",

                    // zIndexが正しい数値ならその値を使用
                    // 値がなければ、配列内の順番
                    zIndex: Number.isFinite(Number(shape.zIndex))
                      ? Number(shape.zIndex)
                      : shapeIndex,
                  }}
                >
                  {/* 図形の見た目本体。
                      通常図形は背景色、テキストは文字色を設定 */}
                  <div
                    className="shape-body"
                    style={{
                      backgroundColor:
                        isText
                          ? "transparent"
                          : shape.fill,

                      color: isText
                        ? shape.fill
                        : undefined,

                      fontSize: isText
                        ? `${shape.fontSize ||
                        24
                        }px`
                        : undefined,

                      fontWeight: isText
                        ? shape.fontWeight ||
                        "normal"
                        : undefined,

                      fontStyle: isText
                        ? shape.fontStyle ||
                        "normal"
                        : undefined,

                      textTransform: isText
                        ? shape.textTransform ||
                        "none"
                        : undefined,
                    }}
                  >
                    {/* テキスト図形かつ編集中ならtextareaを表示 */}
                    {isText &&
                      isEditing ? (
                      <textarea
                        autoFocus
                        className="text-editor"
                        value={draftText}
                        onChange={(
                          event
                        ) => {
                          setDraftText(
                            event.target
                              .value
                          );
                        }}
                        // 入力欄からフォーカスが外れたら文字を保存
                        onBlur={() => {
                          finishTextEditing(
                            shape.id
                          );
                        }}
                        onKeyDown={
                          handleTextKeyDown
                        }
                        onMouseDown={(
                          event
                        ) => {
                          event.stopPropagation();
                        }}
                        onDoubleClick={(
                          event
                        ) => {
                          event.stopPropagation();
                        }}
                      />
                    ) : null}

                    {/* テキスト図形で、編集中でなければ通常文字を表示。 */}
                    {isText &&
                      !isEditing ? (
                      <span className="text-value">
                        {shape.text ||
                          "テキスト"}
                      </span>
                    ) : null}
                  </div>

                  {!isEditing ? (
                    <>
                      {/* 図形のサイズを変える*/}
                      <div
                        className="resize-handle"
                        onMouseDown={(
                          event
                        ) => {
                          startResize(
                            event,
                            shape,
                            {
                              setInteraction,
                              setSelectedId,
                              setEditingId,
                            }
                          );
                        }}
                      />

                      {/* 選択中の図形だけ回転ハンドルを表示 */}
                      {isSelected ? (
                        <div
                          className="rotate-handle"
                          title="ドラッグして回転"
                          onMouseDown={(
                            event
                          ) => {
                            startRotate(
                              event,
                              shape,
                              {
                                setInteraction,
                                setSelectedId,
                                setEditingId,
                              }
                            );
                          }}
                        />
                      ) : null}
                      {/* 選択中かつ文字編集中でない場合図形と逆方向へ回転させ、文字を水平に保ちます。 */}
                      {isSelected && !isEditing ? (
                        <div
                          className="shape-measurement"
                          style={{
                            transform: `
        translateX(-50%)
        rotate(${-(shape.rotation || 0)}deg)
      `,
                          }}
                        >
                          <span>
                            X {Math.round(shape.x)}
                          </span>

                          <span>
                            Y {Math.round(shape.y)}
                          </span>

                          <span>
                            W {Math.round(shape.width)}
                          </span>

                          <span>
                            H {Math.round(shape.height)}
                          </span>

                          <strong>px</strong>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
          </div>
          {/* ここまでが縮小後のキャンバスの大きさの箱 */}
        </main>
          <div className="zoom-bar">
            <button
              type="button"
              className={manualScale === null ? "active" : ""}
              onClick={() => setManualScale(null)}
              title="キャンバス全体が収まる大きさにする"
            >
              全体表示
            </button>
            <input
              type="range"
              min={ZOOM_SLIDER_MIN}
              max={ZOOM_SLIDER_MAX}
              step={5}
              value={Math.round(canvasScale * 100)}
              onChange={(event) => setManualScale(Number(event.target.value) / 100)}
              aria-label="キャンバスの表示倍率"
            />
            <span className="zoom-value">{Math.round(canvasScale * 100)}%</span>
          </div>
        </div>

        <section className={`history-section ${sidebarTab === "ai" ? "is-ai" : ""}`}>
          <div className="sidebar-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "history"}
              className={sidebarTab === "history" ? "active" : ""}
              onClick={() => setSidebarTab("history")}
            >
              編集履歴
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "ai"}
              className={sidebarTab === "ai" ? "active" : ""}
              onClick={() => setSidebarTab("ai")}
            >
              AIアシスタント
            </button>
          </div>
          {sidebarTab === "history" && (
            <HistoryComments userName={userName} />
            )}
          {sidebarTab === "ai" ? (
            <AiChatPanel {...aiChat} shapes={shapes} />
          ) : (
          <div
            className="history-scroll"
            ref={historyScrollRef}
            onScroll={handleHistoryScroll}
          >
          <div className="user-settings">
            表示名：

            <input
              defaultValue={userName}
              onBlur={(event) => {
                setUserName(
                  event.target.value
                );
              }}
            />
          </div>

          {/* 一番上までスクロールして、古い履歴を読み込んでいる間 */}
          {isLoadingOlderHistory && (
            <div className="history-older-status">古い履歴を読み込み中…</div>
          )}
          {/* さかのぼって、一番古い履歴まで来たとき */}
          {!hasOlderHistory && !isLoadingOlderHistory && history.length > HISTORY_PAGE_SIZE && (
            <div className="history-older-status">これより前の履歴はありません</div>
          )}

          <ul className="history-list">
            {/* 履歴の件数だけ */}
            {history.map(
              (historyItem) => (
                <li
                  key={
                    historyItem.id ||
                    `${historyItem.createdAt
                    }-${historyItem.action
                    }`
                  }
                  onClick={() => {
                    // 履歴をクリックすると、その時点へジャンプ。
                    handleHistoryClick(
                      historyItem
                    );
                  }}
                  style={{
                    // ドラッグなどの操作中は半透明にし、
                    // クリック不可に見えるカーソルへ
                    cursor: interaction
                      ? "not-allowed"
                      : "pointer",

                    opacity: interaction
                      ? 0.5
                      : 1,
                  }}
                  title={
                    interaction
                      ? "操作中は履歴ジャンプできません"
                      : "クリックしてこの時点へ移動"
                  }
                >
                  {historyItem.createdAt
                    ? new Date(
                      historyItem.createdAt
                    ).toLocaleTimeString()
                    : "--:--:--"}

                  {" - "}

                  {historyItem.action}

                  {historyItem.objectId &&
                    `（${formatObjectLabel(
                      historyItem
                    )}）`}

                  {" by "}

                  {historyItem.userName ||
                    historyItem.userId?.slice(
                      0,
                      8
                    ) ||
                    "不明"}
                </li>
              )
            )}

            {/* history更新時にここまで自動スクロールします。 */}
            <li
              ref={historyEndRef}
              className="history-end"
            />
          </ul>
          </div>
          )
          }
          {/* ここまでが履歴タブの中身 */}
        </section>
      </div>
    </div>
  );
};

export default App;
