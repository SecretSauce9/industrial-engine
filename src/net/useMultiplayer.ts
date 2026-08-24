// useMultiplayer — React binding for MultiplayerSession.
//
// Owns the session lifecycle and mirrors the reactive bits (lobby, members,
// chat) into React state. The App keeps ownership of the GameState: it
// subscribes to `session.onState(...)` to apply inbound states and calls
// `session.broadcastState(...)` / `session.amDriver(...)` directly.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LobbyState } from "./protocol";
import { MultiplayerSession } from "./session";
import type { ChatLine, HostConfig } from "./session";
import {
  LocalBroadcastTransport,
  SteamTransport,
  steamAvailable,
  type TransportMember,
} from "./transport";

export interface Multiplayer {
  /** Non-null once hosting/joining. */
  session: MultiplayerSession | null;
  lobby: LobbyState | null;
  members: TransportMember[];
  chat: ChatLine[];
  error: string | null;
  /** True when the Steam desktop bridge is present (else only local testing). */
  steam: boolean;
  hostLocal: (cfg: HostConfig) => void;
  joinLocal: (name: string) => void;
  hostSteam: (cfg: HostConfig) => Promise<void>;
  joinSteam: (name: string, lobbyId: string) => Promise<void>;
  invite: () => void;
  leave: () => void;
  clearError: () => void;
}

export function useMultiplayer(): Multiplayer {
  const [session, setSession] = useState<MultiplayerSession | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [members, setMembers] = useState<TransportMember[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<MultiplayerSession | null>(null);

  const attach = useCallback((s: MultiplayerSession) => {
    sessionRef.current = s;
    setSession(s);
    setChat([]);
    setError(null);
    s.onLobby(setLobby);
    s.transport.onMembersChanged(setMembers);
    s.onChat((line) => setChat((c) => [...c.slice(-49), line]));
  }, []);

  const hostLocal = useCallback(
    (cfg: HostConfig) => {
      try {
        const t = new LocalBroadcastTransport({ isHost: true, name: cfg.hostName });
        attach(MultiplayerSession.hostLobby(t, cfg));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attach],
  );

  const joinLocal = useCallback(
    (name: string) => {
      try {
        const t = new LocalBroadcastTransport({ isHost: false, name });
        attach(MultiplayerSession.joinLobby(t));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attach],
  );

  const hostSteam = useCallback(
    async (cfg: HostConfig) => {
      try {
        const t = await SteamTransport.host(cfg.hostName, cfg.seats.length);
        attach(MultiplayerSession.hostLobby(t, cfg));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attach],
  );

  const joinSteam = useCallback(
    async (name: string, lobbyId: string) => {
      try {
        const t = await SteamTransport.join(name, lobbyId);
        attach(MultiplayerSession.joinLobby(t));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attach],
  );

  const invite = useCallback(() => {
    const t = sessionRef.current?.transport;
    if (t instanceof SteamTransport) t.invite();
  }, []);

  const leave = useCallback(() => {
    sessionRef.current?.leave();
    sessionRef.current = null;
    setSession(null);
    setLobby(null);
    setMembers([]);
    setChat([]);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Clean up if the component unmounts mid-session.
  useEffect(() => {
    return () => {
      sessionRef.current?.leave();
      sessionRef.current = null;
    };
  }, []);

  return {
    session,
    lobby,
    members,
    chat,
    error,
    steam: steamAvailable(),
    hostLocal,
    joinLocal,
    hostSteam,
    joinSteam,
    invite,
    leave,
    clearError,
  };
}
