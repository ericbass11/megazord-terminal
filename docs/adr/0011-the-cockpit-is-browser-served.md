# 0011 — The Cockpit is browser-served, and that is a deviation worth taking

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/cockpit/`

## Decision

`mz .` starts a server bound to loopback and the Cockpit is opened in a browser. There is no Electron
shell, no Tauri shell, no menubar and no global shortcut.

`docs/PRODUTO.md` describes a native desktop application, so this is a stated deviation from what the
product promises rather than a reading of it.

## Trade-off

What is lost is the thing the desktop shell is actually for: being present without being asked. A
menubar item that shows a Mission halted at a Gate, a global shortcut that opens the Cockpit over
whatever is in front of the human, a dock badge when a Cap is reached. A served view is one the human
has to go back to, and a Halt is precisely the moment nobody is watching.

It is taken anyway because nothing about a process in a Pane needs a shell. A pseudoterminal is
`node-pty`, streaming is a WebSocket, drawing is `xterm.js`, and a Mission is a file — all four work
identically inside a browser and inside a packaged shell, because the shell would be rendering the
same document over the same socket. What the shell adds is packaging, code signing, automatic updates
and a second build for every platform, and paying for those before a Zord has run once spends the whole
budget on the part that can be added last.

Serving it also keeps the boundary honest in a way a shell would blur. The view is a client of a
documented envelope over a socket; it cannot reach into the process table or the store because it is not
in the same process. A shell makes that reach a one-line temptation, and the rule that the Cockpit holds
no rule is one nobody could then enforce with a test.

## Consequences

- The server binds to loopback with no option to change it, and checks `Origin` although RFC 6455 does
  not require it: a WebSocket is not same-origin restricted, so any site a browser loads could otherwise
  open one into a live process on the machine.
- Nothing may be fetched from a CDN. The repository builds and renders with no network, and a remote
  script would break that in the one place a human would not look — so `xterm.js` reaches the browser
  through the served document.
- Reusing the Next.js application for the view was rejected in the same breath: a WebSocket needs a
  custom server, and coupling the marketing site to the Cockpit joins two things with different
  lifetimes.
- A native shell stays available later and this decision does not block it. It becomes a frame around
  the same document, which is the smallest form it could have taken anyway.
