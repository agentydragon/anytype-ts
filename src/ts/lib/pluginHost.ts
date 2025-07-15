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
  // Load plugin records via DB schema (schema must exist)
  const result = await api.query({
    type: 'Plugin',
    filter: [{ relationKey: 'Enabled', operator: '=', value: true }]
  });
  const records = result.records || [];
    const records = result.records || [];
    // Prepare plugin-facing API object
    const pluginApi: any = {
      // core data operations
      query: api.query?.bind(api),
      create: api.create?.bind(api),
      update: api.update?.bind(api),
      delete: api.delete?.bind(api),
      open: api.open?.bind(api),
      // notifications
      notify: (text: string, options?: { type?: 'info'|'success'|'error' }) => {
        Renderer?.send('notification', { text, ...options });
      },
      // formatting helper
      formatDate: (date: string, fmt: string) => {
        try {
          const { format, parseISO } = require('date-fns');
          return format(parseISO(date), fmt);
        } catch {
          return date;
        }
      },
      // type utilities: get TypeDef ID by key
      getTypeId: async (typeKey: string) => {
        const res = await api.query({ type: 'TypeDef', filter: [ { relationKey: 'key', operator: '=', value: typeKey } ] });
        if (res.records?.length) return res.records[0].id;
        throw new Error(`TypeDef not found for key '${typeKey}'`);
      },
      // query objects of a given Type key
      queryType: async (typeKey: string, filter: any[]) => {
        const typeId = await pluginApi.getTypeId(typeKey);
        return api.query({ type: typeId, filter });
      },
      // find or create object by Type key
      findOrCreate: async (typeKey: string, filter: any[], relations: any) => {
        const typeId = await pluginApi.getTypeId(typeKey);
        const res = await api.query({ type: typeId, filter });
        if (res.records?.length) return res.records[0].id;
        const obj = await api.create({ type: typeId, relations });
        return obj.id;
      },
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
    // Expose React to plugin scripts for UI slots
    pluginApi.React = React;
    pluginApi.h = React.createElement;
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
    // Register built-in "New Plugin" command (requires Plugin Type)
    try {
      const typeDefs = await api.query({
        type: 'TypeDef',
        filter: [{ relationKey: 'key', operator: '=', value: 'plugin' }]
      });
      if (typeDefs.records?.length === 1) {
        const pluginTypeID = typeDefs.records[0].id;
        pluginApi.registerCommand({
          id: 'plugin.new',
          title: 'New Plugin',
          shortcut: 'Ctrl+Shift+P',
          handler: async () => {
            // create empty Plugin instance and open it
            const obj = await api.create({ type: pluginTypeID, relations: { Enabled: [true] } });
            api.open(obj.id);
          }
        });
      }
    } catch (e) {
      console.error('[Plugin] failed to register New Plugin command', e);
    }
  } catch (e) {
    console.error('[Plugin] loadPlugins failed', e);
    api.logError?.(e);
  }
}

/**
 * Save or update a Plugin object in the database.
 * @param api    - API with query, create, update methods
 * @param name   - Unique plugin name
 * @param script - JS code string
 * @param enabled- Boolean flag
 * @returns the object ID of the plugin
 */
export async function savePlugin(
  api: any,
  name: string,
  script: string,
  enabled: boolean
): Promise<string> {
  try {
    // Look for existing plugin by Name relation
    const res = await api.query({ type: 'Plugin', filter: [ { relationKey: 'Name', operator: '=', value: name } ] });
    if (res.records?.length > 0) {
      const id = res.records[0].id;
      // Update Script and Enabled relations
      await api.update({ id, relations: { Script: [script], Enabled: [enabled] } });
      return id;
    } else {
      // Create new Plugin object
      const obj = await api.create({ type: 'Plugin', relations: { Name: [name], Script: [script], Enabled: [enabled] } });
      return obj.id;
    }
  } catch (e) {
    // Persist via DB schema failed
    console.error('[Plugin] savePlugin failed', e);
    api.logError?.(e);
    throw e;
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
      // network fetch (renderer only)
      fetch: typeof fetch !== 'undefined' ? fetch.bind(window) : undefined,
      // persistent storage via Electron store
      storage: {
        get: (key: string) => Renderer?.send('storeGet', key),
        set: (key: string, val: any) => Renderer?.send('storeSet', key, val),
        delete: (key: string) => Renderer?.send('storeDelete', key),
      },
      /**
       * Create or find a new custom Type in Anytype.
       * @param key internal key for the Type
       * @param name display name
       * @param flags optional internalFlags array
       */
      createType: async (key: string, name: string, flags: string[] = []) => {
        // Ensure TypeDef exists
        const rels: any = { key: [key], name: [name] };
        if (flags.length) rels.internalFlags = flags;
        return pluginApi.findOrCreate('TypeDef', [{ relationKey: 'key', operator: '=', value: key }], rels);
      },
      /**
       * Create or find a Relation definition for a given Type key.
       * @param typeKey the internal key of the Type to attach
       * @param key relationKey for the new Relation
       * @param format one of 'Text','LongText','Boolean', etc.
       * @param flags optional internalFlags array
       */
      createRelation: async (typeKey: string, key: string, format: string, flags: string[] = []) => {
        const typeId = await pluginApi.getTypeId(typeKey);
        const rels: any = { key: [key], format: [format], typeDefId: [typeId] };
        if (flags.length) rels.internalFlags = flags;
        return pluginApi.findOrCreate('Relation', [
          { relationKey: 'key', operator: '=', value: key },
          { relationKey: 'typeDefId', operator: '=', value: typeId }
        ], rels);
      },
