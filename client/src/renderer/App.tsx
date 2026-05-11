import {
  Camera,
  Image as ImageIcon,
  Eye,
  MessageCircle,
  Minus,
  Pin,
  PinOff,
  Send,
  Settings,
  Smile,
  Users,
  X
} from 'lucide-react';
import {
  ClipboardEvent,
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { overlayApi } from './overlayApi';
import type { ChatMessage, ConnectionConfig, ImagePayload, Presence, ServerMessage } from './types';

const CONFIG_KEY = 'talk-overlay-config';
const UI_KEY = 'talk-overlay-ui';
const DEFAULT_ROOM_ID = 'CiRCLE';
const MIN_PANEL_OPACITY = 8;
const HEARTBEAT_INTERVAL_MS = 20_000;
const IMAGE_MAX_LONG_EDGE = 1920;
const IMAGE_TARGET_BYTES = 500 * 1024;
const IMAGE_MAX_BYTES = 650 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// 服务器 WebSocket 地址从 Vite 环境变量读取；未配置时默认连接本机 8080，方便开发调试。
const DEFAULT_WS_URL = 'ws://127.0.0.1:8080/ws';
const SERVER_WS_URL = import.meta.env.VITE_CIRCLE_SERVER_WS_URL || DEFAULT_WS_URL;
const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆',
  '😂', '🤣', '😊', '🙂', '🙃',
  '😉', '😍', '😘', '😗', '😙',
  '😋', '😛', '😜', '🤪', '😝',
  '🤔', '🤨', '🧐', '😐', '😑',
  '😶', '🙄', '😏', '😒', '😬',
  '😮', '😯', '😲', '😳', '🥺',
  '😭', '😢', '😤', '😡', '🤬',
  '😱', '😰', '😅', '😎', '🤓',
  '🥳', '😴', '🤤', '🤮', '🤧',
  '👍', '👎', '👏', '🙌', '🙏',
  '🤝', '💪', '👌', '👀', '💯',
  '🔥', '✨', '🎉', '🚀', '✅',
  '❌', '❤️', '💔', '💕', '💬'
];

type SavedConfig = Partial<Pick<ConnectionConfig, 'nickname'>>;
type SavedUi = {
  panelOpacity: number;
  messageOpacity: number;
  alwaysOnTop: boolean;
};
type PendingImage = {
  image: ImagePayload;
  fileName: string;
};
type ComposerMenuPosition = {
  x: number;
  y: number;
  selectionStart: number;
  selectionEnd: number;
  selectedText: string;
};
type MessageMenu = {
  x: number;
  y: number;
  action: 'copy-text' | 'copy-image';
  content?: string;
  image?: ImagePayload;
};

const defaultConfig: ConnectionConfig = {
  nickname: '',
  accessKey: ''
};

const defaultUi: SavedUi = {
  panelOpacity: 38,
  messageOpacity: 100,
  alwaysOnTop: true
};

export function App() {
  const [config, setConfig] = useState<ConnectionConfig>(() => loadInitialConfig());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'joined' | 'disconnected'>('idle');
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showScreenshotMenu, setShowScreenshotMenu] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caretPosition, setCaretPosition] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState('');
  const [imageSending, setImageSending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [previewImage, setPreviewImage] = useState<ImagePayload | null>(null);
  const [composerMenu, setComposerMenu] = useState<ComposerMenuPosition | null>(null);
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null);
  const [ui, setUi] = useState<SavedUi>(() => loadInitialUi());
  const wsRef = useRef<WebSocket | null>(null);
  const joinedRef = useRef(false);
  const heartbeatTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const lastPongAtRef = useRef(0);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSend = status === 'joined' && input.trim().length > 0;
  const currentNickname = config.nickname.trim();
  const activeMention = useMemo(() => getActiveMention(input, caretPosition), [input, caretPosition]);
  const mentionKey = activeMention ? `${activeMention.start}:${activeMention.end}:${activeMention.query}` : '';
  const mentionOptions = useMemo(() => {
    if (!activeMention) {
      return [];
    }
    const query = activeMention.query.toLocaleLowerCase();
    const members = Array.isArray(presence?.members) ? presence.members : [];
    return members
      .filter((member): member is string => typeof member === 'string' && member.trim().length > 0)
      .filter((member) => member.toLocaleLowerCase().includes(query))
      .slice(0, 6);
  }, [activeMention, presence?.members]);
  const showMentionPanel = status === 'joined'
    && Boolean(activeMention)
    && mentionKey !== dismissedMentionKey
    && mentionOptions.length > 0;
  const connectionLabel = useMemo(() => {
    if (status === 'joined') {
      return '已连接';
    }
    if (status === 'connecting') {
      return '连接中';
    }
    if (status === 'disconnected') {
      return '已断开';
    }
    return '未连接';
  }, [status]);

  useEffect(() => {
    const cleanupAlwaysOnTop = overlayApi.onAlwaysOnTopChanged((enabled) => {
      setUi((current) => {
        if (current.alwaysOnTop === enabled) {
          return current;
        }
        return { ...current, alwaysOnTop: enabled };
      });
    });
    return () => {
      cleanupAlwaysOnTop();
    };
  }, []);

  useEffect(() => {
    saveJson(CONFIG_KEY, {
      nickname: config.nickname
    });
  }, [config.nickname]);

  useEffect(() => {
    saveJson(UI_KEY, ui);
    document.documentElement.style.setProperty('--panel-opacity', String(ui.panelOpacity / 100));
    document.documentElement.style.setProperty('--message-opacity', String(ui.messageOpacity / 100));
    overlayApi.setAlwaysOnTop(ui.alwaysOnTop);
  }, [ui.panelOpacity, ui.messageOpacity, ui.alwaysOnTop]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionKey, mentionOptions.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '34px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 82)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      stopHeartbeat();
      cancelMessageLongPress();
      wsRef.current?.close();
    };
  }, []);

  function updateConfig<K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function connect(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (!config.nickname.trim() || !config.accessKey) {
      setError('昵称和口令都要填写');
      return;
    }

    wsRef.current?.close();
    joinedRef.current = false;
    setMessages([]);
    setPresence(null);
    setPendingImage(null);
    setPreviewImage(null);
    setMessageMenu(null);
    setMentionIndex(0);
    setDismissedMentionKey('');
    setStatus('connecting');

    const ws = new WebSocket(SERVER_WS_URL);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      if (wsRef.current !== ws) {
        return;
      }
      ws.send(JSON.stringify({
        type: 'join',
        roomId: DEFAULT_ROOM_ID,
        nickname: config.nickname.trim(),
        accessKey: config.accessKey
      }));
      startHeartbeat(ws);
    });

    ws.addEventListener('message', (event) => {
      if (wsRef.current !== ws) {
        return;
      }
      handleServerMessage(event.data);
    });

    ws.addEventListener('close', () => {
      if (wsRef.current === ws) {
        stopHeartbeat();
        joinedRef.current = false;
        setStatus((current) => (current === 'idle' ? 'idle' : 'disconnected'));
      }
    });

    ws.addEventListener('error', () => {
      if (wsRef.current === ws) {
        stopHeartbeat();
        setError('连接失败，请检查服务端地址和端口');
        setStatus('disconnected');
      }
    });
  }

  function disconnect() {
    stopHeartbeat();
    wsRef.current?.close();
    wsRef.current = null;
    joinedRef.current = false;
    setStatus('idle');
    setPresence(null);
    setPendingImage(null);
    setPreviewImage(null);
    setMessageMenu(null);
  }

  function handleServerMessage(raw: string) {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      setError('收到无法解析的服务端消息');
      return;
    }

    lastPongAtRef.current = Date.now();
    if (message.type === 'pong') {
      return;
    }
    if (message.type === 'joined') {
      joinedRef.current = true;
      setStatus('joined');
      setError('');
      return;
    }
    if (message.type === 'history') {
      setMessages(message.messages ?? []);
      return;
    }
    if (message.type === 'chat') {
      setMessages((current) => [...current, message]);
      if (message.sender !== '' && message.sender !== config.nickname.trim()) {
        void overlayApi.flashAttention().catch(() => undefined);
      }
      return;
    }
    if (message.type === 'presence') {
      setPresence(message);
      return;
    }
    if (message.type === 'error') {
      setError(message.message);
      if (!joinedRef.current) {
        wsRef.current?.close();
        setStatus('idle');
      }
    }
  }

  function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!canSend || !wsRef.current) {
      return;
    }
    if ([...content].length > 500) {
      setError('单条消息最多 500 个字符');
      return;
    }

    wsRef.current.send(JSON.stringify({
      type: 'chat',
      content,
      clientMsgId: randomId()
    }));
    setInput('');
    setCaretPosition(0);
    setDismissedMentionKey('');
    setShowEmoji(false);
  }

  function handleInputChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setInput(event.target.value);
    updateCaretPosition(event.target);
    setComposerMenu(null);
    setMessageMenu(null);
    setDismissedMentionKey('');
    setShowEmoji(false);
    setShowScreenshotMenu(false);
  }

  function handleComposerContextMenu(event: MouseEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    setMessageMenu(null);
    setShowScreenshotMenu(false);
    const selectionStart = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
    const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
    const selectedText = selectionEnd > selectionStart
      ? event.currentTarget.value.slice(selectionStart, selectionEnd)
      : '';
    setCaretPosition(selectionStart);
    const bounds = composerRef.current?.getBoundingClientRect();
    if (!bounds) {
      setComposerMenu({ x: 48, y: 8, selectionStart, selectionEnd, selectedText });
      return;
    }
    setComposerMenu({
      x: clampNumber(event.clientX - bounds.left, 8, bounds.width - 78, 48),
      y: clampNumber(event.clientY - bounds.top, 8, bounds.height - 36, 8),
      selectionStart,
      selectionEnd,
      selectedText
    });
  }

  function handleTextMessageContextMenu(event: MouseEvent<HTMLElement>, content: string) {
    event.preventDefault();
    setComposerMenu(null);
    const selectedText = selectedTextInside(event.currentTarget);
    setMessageMenu({
      ...menuPosition(event.clientX, event.clientY, 78, 38),
      action: 'copy-text',
      content: selectedText || content
    });
  }

  function handleImageMessageContextMenu(event: MouseEvent<HTMLElement>, image: ImagePayload) {
    event.preventDefault();
    setComposerMenu(null);
    setMessageMenu({
      ...menuPosition(event.clientX, event.clientY, 78, 38),
      action: 'copy-image',
      image
    });
  }

  function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }
    void prepareImageFile(file);
  }

  async function startScreenshot(hideWindow: boolean) {
    if (imageSending) {
      return;
    }
    setShowScreenshotMenu(false);
    setShowEmoji(false);
    setComposerMenu(null);
    setMessageMenu(null);

    try {
      const result = await overlayApi.captureScreenshot({ hideWindow });
      if (!result) {
        return;
      }
      await prepareImageFile(dataUrlToFile(result.dataUrl, `screenshot-${Date.now()}.png`), { skipSourceLimit: true });
    } catch {
      setError('截图失败，请重试');
    }
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = firstImageFile(event.clipboardData.files);
    if (!file) {
      return;
    }
    event.preventDefault();
    void prepareImageFile(file);
  }

  function handleChatDragEnter(event: DragEvent<HTMLElement>) {
    if (!hasImageFile(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    setDragActive(true);
  }

  function handleChatDragOver(event: DragEvent<HTMLElement>) {
    if (!hasImageFile(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }

  function handleChatDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDragActive(false);
  }

  function handleChatDrop(event: DragEvent<HTMLElement>) {
    if (!hasImageFile(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    setDragActive(false);
    const file = firstImageFile(event.dataTransfer.files);
    if (file) {
      void prepareImageFile(file);
    }
  }

  async function prepareImageFile(file: File, options: { skipSourceLimit?: boolean } = {}) {
    if (status !== 'joined' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('连接后才能发送图片');
      return;
    }
    if (imageSending) {
      return;
    }
    if (!isAllowedImageFile(file)) {
      setError('仅支持 JPG、PNG、WebP 图片');
      return;
    }
    if (!options.skipSourceLimit && file.size > MAX_SOURCE_IMAGE_BYTES) {
      setError('原图太大，请选择 20MB 以内的图片');
      return;
    }

    setError('');
    setShowEmoji(false);
    setShowScreenshotMenu(false);
    setImageSending(true);
    try {
      const image = await compressImageFile(file);
      setPendingImage({
        image,
        fileName: file.name || '图片'
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : '图片处理失败，请换一张图片');
    } finally {
      setImageSending(false);
    }
  }

  function confirmSendImage() {
    if (!pendingImage) {
      return;
    }
    const ws = wsRef.current;
    if (status !== 'joined' || !ws || ws.readyState !== WebSocket.OPEN) {
      setError('连接已断开，图片没有发送');
      return;
    }
    ws.send(JSON.stringify({
      type: 'chat',
      messageType: 'image',
      content: '',
      image: pendingImage.image,
      clientMsgId: randomId()
    }));
    setPendingImage(null);
  }

  async function pasteFromClipboardMenu() {
    const menu = composerMenu;
    setComposerMenu(null);
    textareaRef.current?.focus();
    try {
      const imageFile = await readImageFileFromClipboard();
      if (imageFile) {
        await prepareImageFile(imageFile);
        return;
      }

      const text = await navigator.clipboard.readText();
      if (text) {
        insertTextAtCaret(text, menu);
      }
    } catch {
      setError('读取剪贴板失败，请使用 Ctrl + V');
    }
  }

  async function copyFromComposerMenu() {
    const selectedText = composerMenu?.selectedText ?? '';
    setComposerMenu(null);
    textareaRef.current?.focus();
    if (!selectedText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch {
      setError('复制失败，请手动选择文本复制');
    }
  }

  async function copyFromMessageMenu() {
    const menu = messageMenu;
    setMessageMenu(null);
    if (!menu) {
      return;
    }

    if (menu.action === 'copy-image' && menu.image) {
      await copyImageContent(menu.image);
      return;
    }

    await copyMessageContent(menu.content ?? '');
  }

  function startMessageLongPress(event: PointerEvent<HTMLElement>, content: string) {
    if (event.pointerType === 'mouse') {
      return;
    }
    cancelMessageLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      void copyMessageContent(content);
    }, 650);
  }

  function cancelMessageLongPress() {
    if (longPressTimerRef.current === null) {
      return;
    }
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  async function copyMessageContent(content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      setError('复制失败，请手动选择文本复制');
    }
  }

  async function copyImageContent(image: ImagePayload) {
    try {
      if (typeof ClipboardItem !== 'function' || typeof navigator.clipboard.write !== 'function') {
        throw new Error('clipboard image write unsupported');
      }
      const blob = await imageToPngBlob(image.dataUrl);
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch {
      setError('复制图片失败，请右键打开预览后手动截图');
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
    setComposerMenu(null);
    setMessageMenu(null);
    setShowScreenshotMenu(false);

    if (showMentionPanel) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((current) => (current + 1) % mentionOptions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(selectedMentionOption(mentionOptions, mentionIndex));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedMentionKey(mentionKey);
        return;
      }
    }

    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    sendMessage();
  }

  function updateCaretPosition(textarea: HTMLTextAreaElement) {
    setCaretPosition(textarea.selectionStart ?? textarea.value.length);
  }

  function insertTextAtCaret(text: string, range?: Pick<ComposerMenuPosition, 'selectionStart' | 'selectionEnd'> | null) {
    const textarea = textareaRef.current;
    const start = range?.selectionStart ?? textarea?.selectionStart ?? caretPosition;
    const end = range?.selectionEnd ?? textarea?.selectionEnd ?? caretPosition;
    const nextInput = `${input.slice(0, start)}${text}${input.slice(end)}`;
    const nextCaretPosition = start + text.length;

    setInput(nextInput);
    setCaretPosition(nextCaretPosition);
    setDismissedMentionKey('');
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  }

  function insertMention(nickname: string) {
    if (!activeMention) {
      return;
    }
    const beforeMention = input.slice(0, activeMention.start);
    const afterMention = input.slice(activeMention.end);
    const nextInput = `${beforeMention}@${nickname} ${afterMention}`;
    const nextCaretPosition = beforeMention.length + nickname.length + 2;

    setInput(nextInput);
    setCaretPosition(nextCaretPosition);
    setDismissedMentionKey('');
    setMentionIndex(0);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  }

  function selectedMentionOption(options: string[], index: number) {
    if (options.length === 0) {
      return '';
    }
    return options[Math.min(index, options.length - 1)] ?? options[0];
  }

  function insertEmoji(emoji: string) {
    setInput((current) => `${current}${emoji}`);
    setDismissedMentionKey('');
  }

  function startHeartbeat(ws: WebSocket) {
    stopHeartbeat();
    lastPongAtRef.current = Date.now();
    heartbeatTimerRef.current = window.setInterval(() => {
      if (wsRef.current !== ws) {
        stopHeartbeat();
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }));
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimerRef.current === null) {
      return;
    }
    window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = null;
  }

  return (
    <div className="app-shell">
      <section className="overlay-panel">
        <header className="titlebar">
          <div className="brand">
            <MessageCircle size={16} />
            <span>CiRCLE</span>
          </div>
          <div className="window-actions">
            {status === 'joined' && (
              <button className="member-button" title="在线成员" onClick={() => setShowMembers((current) => !current)}>
                <Users size={15} />
                <span>{presence ? `${presence.online}/${presence.maxUsers}` : '0/10'}</span>
              </button>
            )}
            <button className="icon-button" title="显示/隐藏设置" onClick={() => setShowSettings((current) => !current)}>
              <Settings size={16} />
            </button>
            <button
              className={`icon-button ${ui.alwaysOnTop ? 'active' : ''}`}
              title={ui.alwaysOnTop ? '取消置顶' : '置顶窗口'}
              onClick={() => setUi((current) => ({ ...current, alwaysOnTop: !current.alwaysOnTop }))}
            >
              {ui.alwaysOnTop ? <Pin size={16} /> : <PinOff size={16} />}
            </button>
            <button className="icon-button" title="最小化" onClick={() => overlayApi.minimize()}>
              <Minus size={16} />
            </button>
            <button className="icon-button danger" title="关闭" onClick={() => overlayApi.close()}>
              <X size={16} />
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="settings-row">
            <label>
              <span>窗口</span>
              <input
                type="range"
                min={MIN_PANEL_OPACITY}
                max="95"
                value={ui.panelOpacity}
                onChange={(event) => setUi((current) => ({ ...current, panelOpacity: Number(event.target.value) }))}
              />
              <strong>{ui.panelOpacity}%</strong>
            </label>
            <label>
              <span>内容</span>
              <input
                type="range"
                min="0"
                max="100"
                value={ui.messageOpacity}
                onChange={(event) => setUi((current) => ({ ...current, messageOpacity: Number(event.target.value) }))}
              />
              <strong>{ui.messageOpacity}%</strong>
            </label>
          </div>
        )}

        {status !== 'joined' ? (
          <div className="connect-view">
            <div className="room-summary">
              <MessageCircle size={18} />
              <div>
                <span>当前房间</span>
                <strong>{DEFAULT_ROOM_ID}</strong>
              </div>
            </div>
            <form className="connect-form" onSubmit={connect}>
              <label>
                <span>昵称</span>
                <input value={config.nickname} onChange={(event) => updateConfig('nickname', event.target.value)} maxLength={20} />
              </label>
              <label>
                <span>口令</span>
                <input
                  type="password"
                  value={config.accessKey}
                  onChange={(event) => updateConfig('accessKey', event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button className="primary-button" type="submit" disabled={status === 'connecting'}>
                {status === 'connecting' ? '连接中...' : '进入房间'}
              </button>
            </form>
          </div>
        ) : (
          <main
            className={`chat-view ${dragActive ? 'dragging' : ''}`}
            onDragEnter={handleChatDragEnter}
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
          >
            {dragActive && <div className="drop-overlay">松开发送图片</div>}
            {showMembers && (
              <div className="members-panel">
                {(presence?.members ?? []).map((member) => (
                  <span key={member}>{member}</span>
                ))}
              </div>
            )}

            <div className="messages" role="log" onClick={() => setMessageMenu(null)}>
              {messages.length === 0 ? (
                <div className="empty-state">
                  <Eye size={18} />
                  <span>还没有消息</span>
                </div>
              ) : (
                messages.map((message) => {
                  const isSystemMessage = message.sender === '';
                  const isMine = message.sender === currentNickname;
                  const isImage = isImageMessage(message);
                  return (
                    <article
                      key={message.messageId}
                      className={`message ${isSystemMessage ? 'system' : isMine ? 'mine' : ''} ${isImage ? 'image' : ''}`}
                      title={isImage ? '点击查看图片，右键复制' : '右键复制'}
                      onContextMenu={isImage && message.image
                        ? (event) => handleImageMessageContextMenu(event, message.image as ImagePayload)
                        : (event) => handleTextMessageContextMenu(event, message.content)}
                      onPointerDown={isImage ? undefined : (event) => startMessageLongPress(event, message.content)}
                      onPointerUp={isImage ? undefined : cancelMessageLongPress}
                      onPointerCancel={isImage ? undefined : cancelMessageLongPress}
                      onPointerLeave={isImage ? undefined : cancelMessageLongPress}
                    >
                      {isSystemMessage ? (
                        <p>{message.content}</p>
                      ) : (
                        <>
                          <div className="message-meta">
                            <span>{message.sender}</span>
                            <time>{formatTime(message.serverTime)}</time>
                          </div>
                          {isImage && message.image ? (
                            <button className="image-message" type="button" onClick={() => setPreviewImage(message.image ?? null)}>
                              <img src={message.image.dataUrl} alt="聊天图片" />
                            </button>
                          ) : (
                            <p>{renderMessageContent(message.content, currentNickname)}</p>
                          )}
                        </>
                      )}
                    </article>
                  );
                })
              )}
              <div ref={messageEndRef} />
            </div>

            <form ref={composerRef} className="composer" onSubmit={sendMessage}>
              {showEmoji && (
                <div className="emoji-panel">
                  {EMOJIS.map((emoji) => (
                    <button type="button" key={emoji} onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className={`icon-button ${showEmoji ? 'active' : ''}`}
                title="表情"
                onClick={() => {
                  setShowEmoji((current) => !current);
                  setShowScreenshotMenu(false);
                  setComposerMenu(null);
                }}
              >
                <Smile size={18} />
              </button>
              <button
                type="button"
                className={`icon-button ${showScreenshotMenu ? 'active' : ''}`}
                title="截图"
                disabled={imageSending}
                onClick={() => {
                  setShowScreenshotMenu((current) => !current);
                  setShowEmoji(false);
                  setComposerMenu(null);
                  setMessageMenu(null);
                }}
              >
                <Camera size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="发送图片"
                disabled={imageSending}
                onClick={() => {
                  setShowScreenshotMenu(false);
                  setShowEmoji(false);
                  fileInputRef.current?.click();
                }}
              >
                <ImageIcon size={18} />
              </button>
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageFileChange}
              />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onContextMenu={handleComposerContextMenu}
                onPaste={handleComposerPaste}
                onKeyDown={handleComposerKeyDown}
                onKeyUp={(event) => updateCaretPosition(event.currentTarget)}
                onClick={(event) => {
                  updateCaretPosition(event.currentTarget);
                  setComposerMenu(null);
                  setShowScreenshotMenu(false);
                }}
                onSelect={(event) => updateCaretPosition(event.currentTarget)}
                placeholder={imageSending ? '图片压缩中...' : '输入消息'}
                maxLength={500}
              />
              <button className="send-button" type="submit" title="发送" disabled={!canSend}>
                <Send size={18} />
              </button>
              {showMentionPanel && (
                <div className="mention-panel">
                  {mentionOptions.map((member, index) => (
                    <button
                      type="button"
                      key={member}
                      className={index === mentionIndex ? 'selected' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertMention(member)}
                    >
                      @{member}
                    </button>
                  ))}
                </div>
              )}
              {showScreenshotMenu && (
                <div className="screenshot-menu">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void startScreenshot(true)}
                  >
                    隐藏窗口截图
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void startScreenshot(false)}
                  >
                    保留窗口截图
                  </button>
                </div>
              )}
              {composerMenu && (
                <div className="composer-menu" style={{ left: composerMenu.x, top: composerMenu.y }}>
                  {composerMenu.selectedText && (
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void copyFromComposerMenu()}
                    >
                      复制
                    </button>
                  )}
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void pasteFromClipboardMenu()}
                  >
                    粘贴
                  </button>
                </div>
              )}
            </form>
          </main>
        )}

        <footer className="statusbar">
          <div className="status-left">
            <span className={`status-dot ${status}`} />
            <span>{connectionLabel}</span>
          </div>
          {status === 'joined' && <button onClick={disconnect}>断开</button>}
        </footer>

        {error && <div className="error-toast">{error}</div>}
        {messageMenu && (
          <div className="message-menu" style={{ left: messageMenu.x, top: messageMenu.y }}>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void copyFromMessageMenu()}
            >
              复制
            </button>
          </div>
        )}
        {pendingImage && (
          <div className="image-confirm-backdrop" onClick={() => setPendingImage(null)}>
            <div className="image-confirm-dialog" onClick={(event) => event.stopPropagation()}>
              <div className="image-confirm-header">
                <strong>发送图片</strong>
                <button type="button" title="取消发送" onClick={() => setPendingImage(null)}>
                  <X size={16} />
                </button>
              </div>
              <img src={pendingImage.image.dataUrl} alt="待发送图片" />
              <div className="image-confirm-meta">
                <span>{pendingImage.fileName}</span>
                <strong>
                  {pendingImage.image.width}×{pendingImage.image.height} · {formatBytes(pendingImage.image.size)}
                </strong>
              </div>
              <div className="image-confirm-actions">
                <button type="button" className="secondary-button" onClick={() => setPendingImage(null)}>
                  取消
                </button>
                <button type="button" className="primary-action-button" onClick={confirmSendImage}>
                  发送
                </button>
              </div>
            </div>
          </div>
        )}
        {previewImage && (
          <div
            className="image-preview-backdrop"
            onClick={() => {
              setPreviewImage(null);
              setMessageMenu(null);
            }}
          >
            <button className="image-preview-close" type="button" title="关闭预览" onClick={() => setPreviewImage(null)}>
              <X size={18} />
            </button>
            <img
              src={previewImage.dataUrl}
              alt="图片预览"
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => handleImageMessageContextMenu(event, previewImage)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function loadJson<T>(key: string, fallback: Partial<T>): Partial<T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as Partial<T> : fallback;
  } catch {
    return fallback;
  }
}

function loadInitialConfig(): ConnectionConfig {
  const saved = loadJson<SavedConfig>(CONFIG_KEY, {});
  return {
    ...defaultConfig,
    nickname: saved.nickname ?? defaultConfig.nickname
  };
}

function loadInitialUi(): SavedUi {
  const saved = loadJson<SavedUi>(UI_KEY, {});
  return {
    panelOpacity: clampNumber(saved.panelOpacity, MIN_PANEL_OPACITY, 95, defaultUi.panelOpacity),
    messageOpacity: clampNumber(saved.messageOpacity, 0, 100, defaultUi.messageOpacity),
    alwaysOnTop: typeof saved.alwaysOnTop === 'boolean' ? saved.alwaysOnTop : defaultUi.alwaysOnTop
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function isImageMessage(message: ChatMessage) {
  return message.messageType === 'image' && Boolean(message.image?.dataUrl);
}

function menuPosition(clientX: number, clientY: number, width: number, height: number) {
  return {
    x: clampNumber(clientX, 8, window.innerWidth - width - 8, 8),
    y: clampNumber(clientY, 8, window.innerHeight - height - 8, 8)
  };
}

function selectedTextInside(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return '';
  }

  const selectedText = selection.toString();
  if (!selectedText) {
    return '';
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    try {
      if (range.intersectsNode(element)) {
        return selectedText;
      }
    } catch {
      return '';
    }
  }
  return '';
}

function isAllowedImageFile(file: File) {
  const lowerName = file.name.toLocaleLowerCase();
  return ALLOWED_IMAGE_TYPES.has(file.type) || /\.(jpe?g|png|webp)$/u.test(lowerName);
}

function firstImageFile(files: FileList) {
  return Array.from(files).find(isAllowedImageFile) ?? null;
}

async function readImageFileFromClipboard() {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    return null;
  }

  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((type) => ALLOWED_IMAGE_TYPES.has(type));
    if (!imageType) {
      continue;
    }
    const blob = await item.getType(imageType);
    return new File([blob], `clipboard-image.${imageExtension(imageType)}`, { type: imageType });
  }
  return null;
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, body] = dataUrl.split(',');
  if (!header || !body) {
    throw new Error('截图数据无效');
  }
  const mimeType = header.match(/^data:(.*?);base64$/u)?.[1] || 'image/png';
  const binary = window.atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType });
}

function imageExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  return 'png';
}

function hasImageFile(dataTransfer: DataTransfer) {
  if (!Array.from(dataTransfer.types).includes('Files')) {
    return false;
  }
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length === 0) {
    return true;
  }
  return items.some((item) => item.kind === 'file' && (item.type === '' || item.type.startsWith('image/')));
}

async function compressImageFile(file: File): Promise<ImagePayload> {
  let decoded: DecodedImage | null = null;
  try {
    decoded = await decodeImage(file);
    if (decoded.width <= 0 || decoded.height <= 0) {
      throw new Error('图片尺寸无效，请换一张图片');
    }

    const { width, height } = fitImageSize(decoded.width, decoded.height, IMAGE_MAX_LONG_EDGE);
    const webpCanvas = drawImageToCanvas(decoded, width, height);
    let blob = await encodeCanvasWithinLimit(webpCanvas, 'image/webp');

    if (!blob) {
      const jpegCanvas = drawImageToCanvas(decoded, width, height, '#ffffff');
      blob = await encodeCanvasWithinLimit(jpegCanvas, 'image/jpeg');
    }

    if (!blob) {
      throw new Error('图片压缩后仍超过 650KB，请换一张更小的图片');
    }

    return {
      mimeType: blob.type,
      dataUrl: await blobToDataUrl(blob),
      width,
      height,
      size: blob.size
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('图片读取失败，请换一张图片');
  } finally {
    decoded?.close();
  }
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close()
      };
    } catch {
      // 某些图片编码浏览器无法直接 createImageBitmap，继续走 Image 兜底解码。
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url)
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，请换一张图片'));
    };
    image.src = url;
  });
}

function fitImageSize(width: number, height: number, maxLongEdge: number) {
  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function drawImageToCanvas(decoded: DecodedImage, width: number, height: number, background?: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前环境不支持图片压缩');
  }
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(decoded.source, 0, 0, width, height);
  return canvas;
}

async function encodeCanvasWithinLimit(canvas: HTMLCanvasElement, mimeType: 'image/webp' | 'image/jpeg') {
  const qualities = [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6, 0.56, 0.52, 0.48];
  let firstUnderLimit: Blob | null = null;

  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, mimeType, quality);
    if (!blob || blob.type !== mimeType) {
      continue;
    }
    if (blob.size <= IMAGE_TARGET_BYTES) {
      return blob;
    }
    if (blob.size <= IMAGE_MAX_BYTES && !firstUnderLimit) {
      firstUnderLimit = blob;
    }
  }

  return firstUnderLimit;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('图片转换失败，请换一张图片'));
    };
    reader.onerror = () => reject(new Error('图片转换失败，请换一张图片'));
    reader.readAsDataURL(blob);
  });
}

function imageToPngBlob(dataUrl: string) {
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('当前环境不支持复制图片'));
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('图片转换失败'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    };
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = dataUrl;
  });
}

function formatBytes(value: number) {
  return `${Math.max(1, Math.round(value / 1024))}KB`;
}

function randomId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getActiveMention(text: string, caretPosition: number) {
  const beforeCaret = text.slice(0, caretPosition);
  const match = beforeCaret.match(/@([^\s@]*)$/u);
  if (!match) {
    return null;
  }
  const query = match[1] ?? '';
  return {
    start: beforeCaret.length - query.length - 1,
    end: caretPosition,
    query
  };
}

function renderMessageContent(content: string, nickname: string): ReactNode {
  if (!nickname) {
    return content;
  }

  const mention = `@${nickname}`;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let nextIndex = content.indexOf(mention);

  while (nextIndex !== -1) {
    if (nextIndex > cursor) {
      nodes.push(content.slice(cursor, nextIndex));
    }
    nodes.push(
      <span className="mention-highlight" key={`${nextIndex}-${mention}`}>
        {mention}
      </span>
    );
    cursor = nextIndex + mention.length;
    nextIndex = content.indexOf(mention, cursor);
  }

  if (cursor < content.length) {
    nodes.push(content.slice(cursor));
  }

  return nodes.length > 0 ? nodes : content;
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value);
}
