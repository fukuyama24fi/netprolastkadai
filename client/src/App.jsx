import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useCanvasSocket } from "./services/UseCanvasSocket";
import {
  useCanvasCalculations,
  useCanvasState,
  useFileOperations,
  useInteractionHandlers,
} from "./hooks";
import { generateFrontendCss, generateFrontendHtml } from "./utils/htmlGenerator";
import { useAiChat } from "./hooks/useAiChat";
import AiChatPanel from "./components/AiChatPanel";
import "./App.css";

// ========== 定数 ==========

const TYPE_LABELS = {
  rect: "四角形",
  circle: "円",
  triangle: "三角形",
  text: "テキスト",
};

const SNAP_THRESHOLD = 6;
const EMPTY_SMART_GUIDES = { vertical: [], horizontal: [] };
const DEFAULT_CANVAS_WIDTH = 2000;
const DEFAULT_CANVAS_HEIGHT = 1400;
const CANVAS_PADDING = 400;
const MIN_SHAPE_SIZE = 30;
const MAX_FONT_SIZE = 200;
const MIN_FONT_SIZE = 8;
const ROTATION_SNAP_ANGLE = 15;
const AUTO_SCROLL_EDGE_SIZE = 80;
const AUTO_SCROLL_SPEED = 24;
// キャンバスを縮小表示するときの最小の倍率（これより小さくなる場合はスクロールで見る）
const MIN_CANVAS_SCALE = 0.25;
// 開いたときのキャンバスの倍率（55%）。「全体表示」を押すと画面に収まる大きさになる
const DEFAULT_CANVAS_SCALE = 0.55;
// 下のスライダーで選べる倍率の範囲（%）
const ZOOM_SLIDER_MIN = 25;
const ZOOM_SLIDER_MAX = 150;
// サーバーが1回に送ってくる履歴の件数（server.js の HISTORY_SEND_LIMIT と同じ）
const HISTORY_PAGE_SIZE = 200;

// 縮小表示中のキャンバスの倍率を、画面上の実際の大きさから求める
// getBoundingClientRect() は縮小後の大きさ、offsetWidth は縮小前の大きさを返すので、その比が倍率になる
const getCanvasScale = (canvas) => {
  if (!canvas || !canvas.offsetWidth) {
    return 1;
  }
  return canvas.getBoundingClientRect().width / canvas.offsetWidth;
};

// ========== コンポーネント ==========

const App = () => {
  // ========== Hooks から取得 ==========
  const {
    shapes,
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
    exportedHtml,
    exportCode,
  } = useCanvasSocket();

  // AIチャット（useCanvasSocket の後に呼ぶ。会話はタブを切り替えても残る）
  const aiChat = useAiChat();
  // 右サイドバーのタブ（"history" または "ai"）
  const [sidebarTab, setSidebarTab] = useState("history");

  const { calculateSmartGuides, calculateLayerReorder } =
    useCanvasCalculations();
  const { updateShapeLocal, getSelectedShape, calculateCanvasSize, clearSelectionState, resetTextEditingState } =
    useCanvasState();
  const { handleSaveJsonFile, handleShowHtmlCode, handleShowCssCode, handleCopyCode } =
    useFileOperations();
  const { startDrag, startResize, startRotate, startTextEditing } =
    useInteractionHandlers();

  // ========== State ==========
  const [viewShapes, setViewShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [interaction, setInteraction] = useState(null);
  const [smartGuides, setSmartGuides] = useState(EMPTY_SMART_GUIDES);
  const [editingId, setEditingId] = useState(null);
  const [draftText, setDraftText] = useState("");
  const [fileName, setFileName] = useState("pikva-canvas");
  const [codeOutput, setCodeOutput] = useState({
    type: "",
    content: "",
  });

  // ========== Refs ==========
  const canvasRef = useRef(null);
  const mainRef = useRef(null);
  const historyEndRef = useRef(null);
  // 履歴タブのスクロールする部分（.history-scroll）
  const historyScrollRef = useRef(null);
  const viewShapesRef = useRef([]);
  const interactionRef = useRef(null);
  const didMoveRef = useRef(false);
  const cancelTextEditRef = useRef(false);

  // ========== Effects ==========

  // interaction参照を最新に保つ
   
  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  // サーバーから受け取った図形を画面へ反映
   
  useEffect(() => {
    if (interactionRef.current) {
      return;
    }

    setViewShapes(shapes);
    viewShapesRef.current = shapes;
  }, [shapes]);

  // 前回描いたときの履歴の様子（一番古い・一番新しい履歴のID、高さ）
  // 履歴がどう変わったかで、スクロールのしかたを変えるために覚えておく
  const prevHistoryInfoRef = useRef(null);

  // 履歴が変わったときのスクロール
  //   ページを開いた直後に履歴がまとめて届いた → アニメーションせずに一気に一番下へ
  //   新しい履歴が増えた（一番新しいIDが変わった） → 一番下の近くを見ていたら、なめらかに一番下へ
  //                                                    （古い履歴を読んでいる途中なら、引き戻さない）
  //   上に古い履歴が付け足された（一番古いIDだけ変わった） → 増えた高さの分だけ下げて、見ている位置を保つ
  // useLayoutEffect なので、画面に描かれる前に位置を直せる（付け足した瞬間に表示がガクッと動かない）
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

    // 履歴タブを開いていないときは何もしない（開いたときに下の処理で一番下へ移動する）
    if (!scroller) {
      return;
    }

    // ページを開いた直後
    if (!prev || prev.lastId === undefined) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }

    // 一番新しい履歴は同じ
    if (prev.lastId === lastId) {
      // 上に古い履歴が付け足された
      if (prev.firstId !== firstId && prev.scrollHeight > 0) {
        scroller.scrollTop += scroller.scrollHeight - prev.scrollHeight;
      }
      return;
    }

    // 新しい履歴が増えた
    // 増える前の高さで、一番下からどれくらい離れていたかを見る（80px以内なら「一番下を見ていた」とする）
    const distanceFromBottom =
      prev.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom > 80) {
      return;
    }
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

  const selectedShape = getSelectedShape(viewShapes, selectedId);
  const isSelectedText = selectedShape?.type === "text";
  const { canvasWidth, canvasHeight } = calculateCanvasSize(viewShapes);

  // ========== キャンバスの縮小表示 ==========
  // キャンバスを縮小して表示する（最初は DEFAULT_CANVAS_SCALE。下のバーで変えられる）
  // 図形の座標（x, y, width, height）は縮小前のまま。見た目だけを transform: scale() で縮める
  // マウスの位置から座標を計算するところ（ドラッグ・リサイズ）は、この縮小率で割って元の大きさに戻している
  //
  // 倍率は2種類あり、どちらを使うかは manualScale で決まる
  //   fitScale    : 全体が収まる倍率（画面の広さから自動で計算する）
  //   manualScale : 下のスライダーで選んだ倍率。null のときは「全体表示」（fitScale を使う）
  //                 最初は DEFAULT_CANVAS_SCALE（55%）
  const [fitScale, setFitScale] = useState(1);
  const [manualScale, setManualScale] = useState(DEFAULT_CANVAS_SCALE);
  // 実際にキャンバスに使う倍率
  const canvasScale = manualScale ?? fitScale;

  useEffect(() => {
    const main = mainRef.current;

    if (!main) {
      return;
    }

    // ドラッグ・リサイズ・回転の途中は縮小率を変えない
    // （図形を端に動かすとキャンバスが広がって縮小率が下がり、図形がマウスから逃げてしまうため）
    // 操作が終わると interaction が null になって、ここがもう一度動く
    if (interaction) {
      return;
    }

    const updateScale = () => {
      // .main の padding とキャンバスの枠線（左右・上下で2px）を除いた、使える広さ
      const style = window.getComputedStyle(main);
      const availableWidth =
        main.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        2;
      const availableHeight =
        main.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom) -
        2;

      // 幅と高さの両方が収まる縮小率。拡大はしない（最大1倍）
      // 小さくなりすぎると操作できないので MIN_CANVAS_SCALE より小さくはしない（そのときはスクロールになる）
      const nextScale = Math.max(
        MIN_CANVAS_SCALE,
        Math.min(1, availableWidth / canvasWidth, availableHeight / canvasHeight)
      );

      setFitScale(nextScale);
    };

    updateScale();

    // ウィンドウの大きさが変わったときも合わせ直す
    const observer = new ResizeObserver(updateScale);
    observer.observe(main);

    return () => {
      observer.disconnect();
    };
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

      if (event.shiftKey) {
        setSmartGuides(EMPTY_SMART_GUIDES);
        updateShapeLocal(interaction.id, { x: newX, y: newY }, setViewShapes, viewShapesRef);
        return;
      }

      const snapResult = calculateSmartGuides(
        { ...movingShape, x: newX, y: newY },
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

  // 回転移動の処理
   
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

  // 図形追加
   
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
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

  // レイヤー移動
   
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

  // HTML表示

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
      <header className="app-header">
        <strong className="app-header-title">
          <img src="/pictuer/2aikon.png" alt="Pikva Icon" />
          Pikva
        </strong>

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

        <button type="button">開く</button>

        <button type="button">PNG出力</button>

        <button type="button" onClick={handleClickShowHtml}>
          HTML出力
        </button>

        <button type="button" onClick={handleClickShowCss}>
          CSS出力
        </button>
      </header>

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

          <textarea
            className="code-output-textarea"
            value={codeOutput.content}
            readOnly
            spellCheck={false}
          />
        </section>
      )}

      <div className="app-body">
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

            <button
              type="button"
              onClick={() =>
                handleAddShape("text")
              }
            >
              テキストを追加
            </button>
          </div>

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

        {/* キャンバスの表示部分（上：キャンバス、下：拡大縮小のバー） */}
        <div className="canvas-area">
        <main
          ref={mainRef}
          className="main"
        >
          {/* 縮小後のキャンバスの大きさの箱 */}
          {/* transform: scale() は見た目だけを縮め、場所は元の大きさのまま取ってしまうので、 */}
          {/* この箱で「縮小後の大きさ」だけ場所を取り、はみ出した分は隠す */}
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
              if (
                event.target ===
                event.currentTarget
              ) {
                setSelectedId(null);
                setEditingId(null);
              }
            }}
          >
            {smartGuides.vertical.map((guideX) => (
              <div
                key={`vertical-${guideX}`}
                className="smart-guide smart-guide-vertical"
                style={{
                  left: `${guideX}px`,
                }}
              />
            ))}

            {smartGuides.horizontal.map((guideY) => (
              <div
                key={`horizontal-${guideY}`}
                className="smart-guide smart-guide-horizontal"
                style={{
                  top: `${guideY}px`,
                }}
              />
            ))}

            {viewShapes.map((shape, shapeIndex) => {
              const isSelected =
                shape.id === selectedId;

              const shapeType =
                shape.type || "rect";

              const isText =
                shapeType === "text";

              const isEditing =
                editingId === shape.id;

              return (
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
                    left: `${shape.x}px`,
                    top: `${shape.y}px`,
                    width: `${shape.width}px`,
                    height: `${shape.height}px`,

                    transform: `rotate(${shape.rotation || 0
                      }deg)`,

                    transformOrigin:
                      "center center",

                    zIndex: Number.isFinite(Number(shape.zIndex))
                      ? Number(shape.zIndex)
                      : shapeIndex,
                  }}
                >
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

          {/* 拡大縮小のバー。スライダーで倍率を選ぶと manualScale に入り、「全体表示」で null（自動）に戻る */}
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
              onChange={(event) => {
                setManualScale(Number(event.target.value) / 100);
              }}
              aria-label="キャンバスの表示倍率"
            />
            {/* 今の倍率（%） */}
            <span className="zoom-value">
              {Math.round(canvasScale * 100)}%
            </span>
          </div>
        </div>
        {/* ここまでがキャンバスの表示部分 */}

        <section
          className={`history-section ${sidebarTab === "ai" ? "is-ai" : ""}`}
        >
          {/* 履歴 / AI のタブ */}
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

          {/* AIタブならAIチャット、履歴タブなら今までの表示名と編集履歴を出す */}
          {/* shapes はAIの提案のプレビューを描くのに使う */}
          {sidebarTab === "ai" ? (
            <AiChatPanel {...aiChat} shapes={shapes} />
          ) : (
          // 履歴タブの中身。タブを固定するため、スクロールはこの中だけで行う
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
                    handleHistoryClick(
                      historyItem
                    );
                  }}
                  style={{
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

            <li
              ref={historyEndRef}
              className="history-end"
            />
          </ul>
          </div>
          )}
          {/* ここまでが履歴タブの中身 */}
        </section>
      </div>
    </div>
  );
};

export default App;
