export interface Identity {
  id: string;
  label: string;
  tier: 0 | 1 | 2 | 3;
  description: string;
}

export interface UiError {
  code: string;
  message: string;
}

export interface ActionState {
  busy: "approve" | "ack" | null;
  error: UiError | null;
}

export type Route = "board" | "status" | "projector" | "join" | "me";
