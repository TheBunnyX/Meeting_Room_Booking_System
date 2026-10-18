"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../app/components/icons";
import { apiFetch } from "../../lib/api";
import type { Participant } from "../../lib/types";

type ParticipantPickerProps = { selected: Participant[]; onChange: (participants: Participant[]) => void };

export function ParticipantPicker({ selected, onChange }: ParticipantPickerProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Participant[]>([]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    // Debounced so a search is sent only once typing pauses.
    const timer = window.setTimeout(async () => {
      try {
        const users = await apiFetch<Participant[]>(`/api/v1/participants/search?q=${encodeURIComponent(text)}`);
        if (!cancelled) setSuggestions(users);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const chosen = new Set(selected.map((participant) => participant.email.toLowerCase()));
  const available = suggestions.filter((participant) => !chosen.has(participant.email.toLowerCase()));

  function add(participant: Participant) {
    onChange([...selected, participant]);
    setQuery("");
    setSuggestions([]);
  }

  return <div className="field full">
    <label htmlFor="participant-search">Invite participants <span>(search by name or email)</span></label>
    <div className="participant-picker">
      <div className="participant-chips">
        {selected.map((participant) => <span className="participant-chip" key={participant.email}>
          <span>{participant.full_name} <small>{participant.email}</small></span>
          <button type="button" onClick={() => onChange(selected.filter((item) => item.email !== participant.email))} aria-label={`Remove ${participant.email}`}><Icon name="close" size={13} /></button>
        </span>)}
      </div>
      <input id="participant-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people or email" autoComplete="off" />
    </div>
    {available.length > 0 && <div className="participant-suggestions">
      {available.map((participant) => <button type="button" className="participant-suggestion" key={participant.id} onClick={() => add(participant)}><strong>{participant.full_name}</strong><small>{participant.email}</small></button>)}
    </div>}
  </div>;
}
