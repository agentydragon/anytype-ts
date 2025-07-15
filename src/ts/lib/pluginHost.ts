// pluginHost.ts
// A simple JS plugin host for Anytype clients

import React from 'react';
// Dynamically load Renderer for command events (may not exist in test env)
let Renderer: any;
try {
  Renderer = require('./renderer').default;
} catch (_) {
  Renderer = null;
}
// Hook registries
const onAppStartHandlers: Array<() => void> = [];
const onObjectOpenHandlers: Array<(info: any) => void> = [];
const onCollectionViewRenderHandlers: Array<(info: any) => void> = [];
// Slot registry: slotName -> [renderFn]
const slotMap: Map<string, Array<(props: any) => React.ReactNode>> = new Map();

/** Register a function to run when the app starts */
export function onAppStart(fn: () => void) {
  onAppStartHandlers.push(fn);
}
/** Register a function to run when an object is opened */
export function onObjectOpen(fn: (info: any) => void) {
  onObjectOpenHandlers.push(fn);
}
/** Register a function to run when a collection view renders */
export function onCollectionViewRender(fn: (info: any) => void) {
  onCollectionViewRenderHandlers.push(fn);
}
/** Register a slot renderer for named UI slots */
export function registerSlot(slotName: string, renderFn: (props: any) => React.ReactNode) {
  const arr = slotMap.get(slotName) || [];
  arr.push(renderFn);
  slotMap.set(slotName, arr);
}
/** Render all registered slot renderers for this slot */
export function renderSlot(slotName: string, props: any): React.ReactNode[] {
  const arr = slotMap.get(slotName) || [];
  return arr.map(fn => fn(props));
}

// Command handlers registry
const commandHandlers: Map<string, (arg?: any) => void> = new Map();
// Listen for global command invocations from Renderer, if available
if (Renderer?.on) {
  Renderer.on('commandGlobal', (e: any, cmd: string, arg: any) => {
    const handler = commandHandlers.get(cmd);
    if (handler) {
      try { handler(arg); } catch (e) { console.error('[Plugin] command handler error', e); }
    }
  });
}
/** Load and execute enabled Plugin scripts */
export async function loadPlugins(api: any) {
  try {
    // Query Plugin objects where relation 'Enabled' = true
    const result = await api.query({
      type: 'Plugin',
      filter: [{ relationKey: 'Enabled', operator: '=', value: true }]
    });
    const records = result.records || [];
    // Prepare plugin-facing API object
    const pluginApi: any = {
      // core data operations
      query: api.query?.bind(api),
      create: api.create?.bind(api),
      open: api.open?.bind(api),
      // lifecycle hooks
      onAppStart,
      onObjectOpen,
      onCollectionViewRender,
      // UI slot injection
      registerSlot,
      // command registration: store handler and delegate to optional api.registerCommand
      registerCommand: ({ id, title, shortcut, handler }: any) => {
        commandHandlers.set(id, handler);
        if (api.registerCommand) api.registerCommand({ id, title, shortcut });
      }
    };
    for (const rec of records) {
      const script = rec.relations?.Script?.[0]?.value;
      if (typeof script === 'string') {
        try {
          // Evaluate plugin script with single 'plugin' argument
          const pluginFn = new Function('plugin', script);
          pluginFn(pluginApi);
        } catch (e) {
          console.error('[Plugin] script error in', rec.id, e);
          api.logError?.(e);
        }
      }
    }
    // Invoke onAppStart handlers
    for (const fn of onAppStartHandlers) {
      try { fn(); } catch (e) { console.error('[Plugin] onAppStart handler', e); }
    }
  } catch (e) {
    console.error('[Plugin] loadPlugins failed', e);
    api.logError?.(e);
  }
}
/**
 * Test helper: invoke a registered command handler directly.
 */
export function _invokeCommand(id: string, arg?: any) {
  const handler = commandHandlers.get(id);
  if (!handler) throw new Error(`No command handler for '${id}'`);
  return handler(arg);
}
