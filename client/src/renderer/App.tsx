import {
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
  ChangeEvent,
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
import type { ChatMessage, ConnectionConfig, Presence, ServerMessage } from './types';

const CONFIG_KEY = 'talk-overlay-config';
const UI_KEY = 'talk-overlay-ui';
const DEFAULT_ROOM_ID = 'CiRCLE';
const MIN_PANEL_OPACITY = 8;
const HEARTBEAT_INTERVAL_MS = 20_000;

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
  const [showMembers, setShowMembers] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caretPosition, setCaretPosition] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState('');
  const [notice, setNotice] = useState('');
  const [ui, setUi] = useState<SavedUi>(() => loadInitialUi());
  const wsRef = useRef<WebSocket | null>(null);
  const joinedRef = useRef(false);
  const heartbeatTimerRef = useRef<number | null>(null);
  const copyNoticeTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const lastPongAtRef = useRef(0);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
      stopCopyNoticeTimer();
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
    setDismissedMentionKey('');
    setShowEmoji(false);
  }

  async function copyMessage(event: MouseEvent<HTMLElement>, content: string) {
    event.preventDefault();
    await copyMessageContent(content);
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
      setNotice('已复制');
      stopCopyNoticeTimer();
      copyNoticeTimerRef.current = window.setTimeout(() => {
        setNotice('');
        copyNoticeTimerRef.current = null;
      }, 1200);
    } catch {
      setError('复制失败，请手动选择文本复制');
    }
  }

  function stopCopyNoticeTimer() {
    if (copyNoticeTimerRef.current === null) {
      return;
    }
    window.clearTimeout(copyNoticeTimerRef.current);
    copyNoticeTimerRef.current = null;
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();

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
          <main className="chat-view">
            {showMembers && (
              <div className="members-panel">
                {(presence?.members ?? []).map((member) => (
                  <span key={member}>{member}</span>
                ))}
              </div>
            )}

            <div className="messages" role="log">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <Eye size={18} />
                  <span>还没有消息</span>
                </div>
              ) : (
                messages.map((message) => {
                  const isSystemMessage = message.sender === '';
                  const isMine = message.sender === currentNickname;
                  return (
                    <article
                      key={message.messageId}
                      className={`message ${isSystemMessage ? 'system' : isMine ? 'mine' : ''}`}
                      title="右键复制"
                      onContextMenu={(event) => copyMessage(event, message.content)}
                      onPointerDown={(event) => startMessageLongPress(event, message.content)}
                      onPointerUp={cancelMessageLongPress}
                      onPointerCancel={cancelMessageLongPress}
                      onPointerLeave={cancelMessageLongPress}
                    >
                      {isSystemMessage ? (
                        <p>{message.content}</p>
                      ) : (
                        <>
                          <div className="message-meta">
                            <span>{message.sender}</span>
                            <time>{formatTime(message.serverTime)}</time>
                          </div>
                          <p>{renderMessageContent(message.content, currentNickname)}</p>
                        </>
                      )}
                    </article>
                  );
                })
              )}
              <div ref={messageEndRef} />
            </div>

            <form className="composer" onSubmit={sendMessage}>
              {showEmoji && (
                <div className="emoji-panel">
                  {EMOJIS.map((emoji) => (
                    <button type="button" key={emoji} onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="icon-button" title="emoji" onClick={() => setShowEmoji((current) => !current)}>
                <Smile size={18} />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleComposerKeyDown}
                onKeyUp={(event) => updateCaretPosition(event.currentTarget)}
                onClick={(event) => updateCaretPosition(event.currentTarget)}
                onSelect={(event) => updateCaretPosition(event.currentTarget)}
                placeholder="输入消息"
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

        {notice && <div className="notice-toast">{notice}</div>}
        {error && <div className={`error-toast ${notice ? 'stacked' : ''}`}>{error}</div>}
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
