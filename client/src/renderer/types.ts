export type MessageType = 'text' | 'image';

export type ImagePayload = {
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  size: number;
};

export type ChatMessage = {
  messageId: string;
  sender: string;
  content: string;
  serverTime: number;
  messageType?: MessageType;
  image?: ImagePayload | null;
};

export type Presence = {
  roomId: string;
  online: number;
  maxUsers: number;
  members: string[];
};

export type ConnectionConfig = {
  nickname: string;
  accessKey: string;
};

export type ServerMessage =
  | { type: 'joined'; roomId: string; online: number }
  | { type: 'history'; messages: ChatMessage[] }
  | ({ type: 'chat' } & ChatMessage)
  | ({ type: 'presence' } & Presence)
  | { type: 'error'; message: string }
  | { type: 'pong'; serverTime: number };
