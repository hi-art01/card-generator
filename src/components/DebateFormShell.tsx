'use client';

import React, { useSyncExternalStore } from 'react';
import { DebateForm } from './DebateForm';

const subscribe = () => () => undefined;
const getServerSnapshot = () => false;
const getClientSnapshot = () => true;

export function DebateFormShell() {
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted) {
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted-foreground)',
          fontSize: '1.1rem',
          fontWeight: 500,
        }}
      >
        Initializing Debate Prepper...
      </div>
    );
  }

  return <DebateForm />;
}
