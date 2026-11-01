import React from 'react';
// Build-time native replacement: browser video/CSS are absent from the native JS graph.
export function WebWelcome({children}:{children:React.ReactNode;onHelp:()=>void;onRequest:()=>void}) { return <>{children}</>; }
