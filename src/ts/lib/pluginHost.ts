// pluginHost.ts
// Minimal JS plugin host for Anytype clients

import React from 'react'
import Renderer from './renderer'
import { C, S, I, U, Relation } from 'Lib'

// Plugin relation constants
const PLUGIN_RELATIONS = {
  SCRIPT: 'plugin_script',
  ENABLED: 'plugin_enabled'
} as const

/**
 * Install Plugin schema (type and relations) in Anytype
 * This creates the Plugin object type and its required relations
 */
export async function installPluginSchema(providedSpaceId?: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const spaceId = providedSpaceId || S.Common.space || ''
    console.log('[Plugin] Debug - providedSpaceId:', providedSpaceId)
    console.log('[Plugin] Debug - spaceId:', spaceId)
    console.log('[Plugin] Debug - S.Common.space:', S.Common.space)
    console.log('[Plugin] Debug - S.Common.spaceId:', S.Common.spaceId)
    
    if (!spaceId) {
      reject(new Error('No space available'))
      return
    }

    console.log('[Plugin] Installing Plugin schema...')

    // First, check if Plugin type already exists
    try {
      // Check by unique key (most reliable)
      const existingByKey = await new Promise<any>((resolve, reject) => {
        const filters = [
          { relationKey: 'uniqueKey', condition: I.FilterCondition.Equal, value: 'ot-plugin' },
          { relationKey: 'layout', condition: I.FilterCondition.Equal, value: I.ObjectLayout.Type }
        ]
        const sorts: any[] = []
        const keys = ['id', 'name', 'uniqueKey', 'layout']
        
        C.ObjectSearch(spaceId, filters, sorts, keys, '', 0, 10, (response: any) => {
          if (response.error && response.error.code !== 0) {
            reject(new Error(response.error.description || 'Search failed'))
          } else {
            resolve(response)
          }
        })
      })

      if (existingByKey.records && existingByKey.records.length > 0) {
        console.log('[Plugin] Plugin type already exists (found by unique key), skipping schema installation')
        existingByKey.records.forEach(record => {
          console.log(`[Plugin] Existing type: ${record.name} (${record.id}) with key: ${record.uniqueKey}`)
        })
        resolve()
        return
      }
      
      
      console.log('[Plugin] No existing Plugin type found, proceeding with installation')
    } catch (e) {
      console.log('[Plugin] Could not check for existing types:', e?.message || e)
      console.log('[Plugin] Proceeding with installation anyway')
    }

    // Step 1: Create Plugin relations first  
    const relations = [
      {
        name: 'Script',
        key: PLUGIN_RELATIONS.SCRIPT,
        details: {
          name: 'Script',
          relationFormat: I.RelationType.LongText,
          origin: 9, // ObjectOrigin_api
          type: 'ot-relation',
          apiObjectKey: PLUGIN_RELATIONS.SCRIPT
        }
      },
      {
        name: 'Enabled',
        key: PLUGIN_RELATIONS.ENABLED,
        details: {
          name: 'Enabled',
          relationFormat: I.RelationType.Checkbox,
          origin: 9, // ObjectOrigin_api
          type: 'ot-relation',
          apiObjectKey: PLUGIN_RELATIONS.ENABLED
        }
      }
    ]

    let createdRelations = 0
    const relationIds: string[] = []

    // Create each relation
    relations.forEach((relation, index) => {
      C.ObjectCreateRelation(relation.details, spaceId, (response: any) => {
        if (response.error && response.error.code !== 0) {
          console.error(`[Plugin] Failed to create relation ${relation.name}:`, response.error)
          reject(new Error(`Failed to create relation ${relation.name}: ${response.error.description || 'Unknown error'}`))
          return
        } else {
          console.log(`[Plugin] Created relation: ${relation.name}`)
          relationIds[index] = response.objectId
        }
        
        createdRelations++
        if (createdRelations === relations.length) {
          // Step 2: Create Plugin object type
          createPluginType(spaceId, relationIds, resolve, reject)
        }
      })
    })
  })
}

function createPluginType(spaceId: string, relationIds: string[], resolve: Function, reject: Function) {
  const pluginTypeDetails = {
    name: 'Plugin',
    pluralName: 'Plugins',
    recommendedLayout: I.ObjectLayout.Page,
    origin: 9, // ObjectOrigin_api
    uniqueKey: 'ot-plugin', // Constant type key following Anytype convention
    iconEmoji: '🔌'
  }

  C.ObjectCreateObjectType(pluginTypeDetails, [], spaceId, (response: any) => {
    if (response.error && response.error.code !== 0) {
      console.error('[Plugin] Failed to create Plugin type:', response.error)
      reject(new Error(`Failed to create Plugin type: ${response.error.description || 'Unknown error'}`))
    } else {
      console.log('[Plugin] Created Plugin object type:', response.objectId)
      
      // Step 3: Link relations to the Plugin type
      linkRelationsToType(response.objectId, relationIds, spaceId, resolve, reject)
    }
  })
}

function linkRelationsToType(typeId: string, relationIds: string[], spaceId: string, resolve: Function, reject: Function) {
  console.log('[Plugin] Linking relations to Plugin type')
  console.log('[Plugin] Plugin type ID:', typeId)
  console.log('[Plugin] Plugin relations:', relationIds)
  
  // Link relations to the Plugin type by adding them to recommendedRelations
  const relationKeys = [PLUGIN_RELATIONS.SCRIPT, PLUGIN_RELATIONS.ENABLED] // Use the snake_case prefixed relation keys we defined
  
  // Use ObjectListSetDetails to set the recommendedRelations for the Plugin type
  C.ObjectListSetDetails([typeId], [{
    recommendedRelations: relationIds
  }], (response: any) => {
    if (response.error && response.error.code !== 0) {
      console.error('[Plugin] Failed to link relations to Plugin type:', response.error)
      console.log('[Plugin] Relation linking failed, but continuing with schema installation')
    } else {
      console.log('[Plugin] Successfully linked relations to Plugin type')
      console.log('[Plugin] Plugin type now has recommended relations:', relationIds)
    }
    
    // Step 4: Create a default template for Plugin objects
    createPluginTemplate(typeId, spaceId, resolve, reject)
  })
}

function createPluginTemplate(pluginTypeId: string, spaceId: string, resolve: Function, reject: Function) {
  // Create a default template for Plugin objects that includes Script and Enabled fields
  const templateDetails = {
    name: 'Default Plugin Template',
    targetObjectType: pluginTypeId,
    // Set default values for the template that will be applied to new Plugin objects
    [PLUGIN_RELATIONS.SCRIPT]: '// Write your plugin code here\n// Example:\n// plugin.onAppStart(() => {\n//   plugin.notify("Plugin loaded!");\n// });',
    [PLUGIN_RELATIONS.ENABLED]: false
  }
  
  console.log('[Plugin] Creating Plugin template with details:', templateDetails)
  
  C.ObjectCreate(templateDetails, [], '', 'ot-template', spaceId, (response: any) => {
    if (response.error && response.error.code !== 0) {
      console.error('[Plugin] Failed to create Plugin template:', response.error)
      // Don't fail the entire schema installation if template creation fails
      console.log('[Plugin] Template creation failed, but continuing with schema installation')
      resolve()
    } else {
      console.log('[Plugin] Created Plugin template:', response.objectId)
      
      // Step 5: Assign the template as the default template for the Plugin type
      assignTemplateToType(pluginTypeId, response.objectId, resolve, reject)
    }
  })
}

function assignTemplateToType(pluginTypeId: string, templateId: string, resolve: Function, reject: Function) {
  console.log('[Plugin] Assigning template', templateId, 'to Plugin type', pluginTypeId)
  
  C.ObjectListSetDetails([pluginTypeId], [{
    defaultTemplateId: templateId
  }], (response: any) => {
    if (response.error && response.error.code !== 0) {
      console.error('[Plugin] Failed to assign template to Plugin type:', response.error)
      // Don't fail the entire schema installation if template assignment fails
      console.log('[Plugin] Template assignment failed, but continuing with schema installation')
    } else {
      console.log('[Plugin] Successfully assigned template as default for Plugin type')
      console.log('[Plugin] New Plugin objects will now use the default template')
    }
    resolve()
  })
}

// Lifecycle hooks
const onAppStartHandlers: Array<() => void> = []
const onObjectOpenHandlers: Array<(info: any) => void> = []
const onCollectionViewRenderHandlers: Array<(info: any) => void> = []
export function onAppStart(fn: () => void) { onAppStartHandlers.push(fn) }
export function onObjectOpen(fn: (info: any) => void) { onObjectOpenHandlers.push(fn) }
export function onCollectionViewRender(fn: (info: any) => void) { onCollectionViewRenderHandlers.push(fn) }

// UI Slot System
const slotMap = new Map<string, Array<(props: any) => React.ReactNode>>()
export function registerSlot(slot: string, fn: (props: any) => React.ReactNode) {
  const arr = slotMap.get(slot) || []
  arr.push(fn)
  slotMap.set(slot, arr)
}
export function renderSlot(slot: string, props: any): React.ReactNode[] {
  return (slotMap.get(slot) || []).map(fn => fn(props))
}

// Command Registry
const commandHandlers = new Map<string, (arg?: any) => void>()
export function invokeCommand(id: string, arg?: any) {
  const h = commandHandlers.get(id)
  if (!h) throw new Error(`No plugin command '${id}'`)
  return h(arg)
}

// Flag to prevent multiple initializations
let isInitialized = false

/**
 * Initialize plugin system by installing schema and loading plugins
 * @param dispatcher The dispatcher object
 * @param spaceId Optional space ID to use instead of S.Common.space
 */
export async function initializePluginSystem(dispatcher: any, spaceId?: string) {
  if (isInitialized) {
    console.log('[Plugin] Plugin system already initialized, skipping')
    return
  }
  
  // Check if we have a valid space ID before proceeding
  const actualSpaceId = spaceId || S.Common.space
  if (!actualSpaceId) {
    console.warn('[Plugin] No space ID available, cannot initialize plugin system')
    return
  }
  
  try {
    console.log('[Plugin] Initializing plugin system...')
    
    // First, install the plugin schema (type and relations)
    // This MUST succeed for plugin system to work
    await installPluginSchema(actualSpaceId)
    console.log('[Plugin] Schema installation completed')
    
    // Then load and execute plugins
    await loadPlugins(dispatcher)
    
    isInitialized = true
    console.log('[Plugin] Plugin system fully initialized')
  } catch (error) {
    console.error('[Plugin] Failed to initialize plugin system:', error)
    console.error('[Plugin] Plugin system will not be available')
  }
}

/**
 * Load and execute all enabled plugins.
 * @param dispatcher The dispatcher object
 */
export async function loadPlugins(dispatcher: any) {
  // Helper function to map filters with proper format
  const filterMapper = (filter: any) => {
    const relation = S.Record.getRelationByKey(filter.relationKey)
    if (relation) {
      filter.format = relation.format
    }
    // Ensure condition is a number (FilterCondition enum) and remove operator
    if (filter.operator === '=') {
      filter.condition = I.FilterCondition.Equal
    } else if (filter.operator === '!=') {
      filter.condition = I.FilterCondition.NotEqual
    } else if (filter.operator === '>') {
      filter.condition = I.FilterCondition.Greater
    } else if (filter.operator === '<') {
      filter.condition = I.FilterCondition.Less
    } else {
      filter.condition = filter.condition || I.FilterCondition.Equal
    }
    // Remove the operator property as it's not used by the protobuf
    delete filter.operator
    return filter
  }


  // Create API wrapper with proper methods
  const api = {
    find: (query: any) => {
      return new Promise((resolve, reject) => {
        const spaceId = S.Common.space || ''
        const filters = (query.filter || []).map(filterMapper)
        const sorts = query.sorts || []
        const keys = query.keys || ['id', 'name', 'type', 'relations']
        
        C.ObjectSearch(spaceId, filters, sorts, keys, '', 0, 100, (response: any) => {
          if (response.error && response.error.code !== 0) {
            reject(new Error(response.error.description || 'Search failed'))
          } else {
            resolve({ records: response.records || [] })
          }
        })
      })
    },
    create: (data: any) => {
      return new Promise((resolve, reject) => {
        const spaceId = S.Common.space || ''
        const details = data.details || {}
        const flags = data.flags || []
        const templateId = data.templateId || ''
        const typeKey = data.typeKey || data.type || 'page'
        
        C.ObjectCreate(details, flags, templateId, typeKey, spaceId, (response: any) => {
          if (response.error) {
            reject(new Error(response.error.description || 'Create failed'))
          } else {
            resolve(response.details)
          }
        })
      })
    },
    update: (id: string, data: any) => {
      return new Promise((resolve, reject) => {
        const details = data.details || data
        
        C.ObjectListSetDetails([id], [details], (response: any) => {
          if (response.error) {
            reject(new Error(response.error.description || 'Update failed'))
          } else {
            resolve(response)
          }
        })
      })
    },
    delete: (id: string) => {
      return new Promise((resolve, reject) => {
        // Note: Object deletion in Anytype is complex and may require special handling
        reject(new Error('Delete not implemented - use archive instead'))
      })
    },
    open: (id: string) => {
      return new Promise((resolve, reject) => {
        const spaceId = S.Common.space || ''
        const traceId = ''
        
        C.ObjectOpen(id, traceId, spaceId, (response: any) => {
          if (response.error) {
            reject(new Error(response.error.description || 'Open failed'))
          } else {
            resolve(response.objectView)
          }
        })
      })
    },
    registerCommand: (command: any) => {
      // This would need to be implemented to register commands
      console.log('[Plugin] registerCommand not implemented:', command)
    }
  }

  let res
  try {
    // Debug: First, let's see what types exist
    console.log('[Plugin] Searching for Plugin objects...')
    
    // Find Plugin objects by type unique key
    res = await api.find({
      filter: [
        { relationKey: 'type.uniqueKey', condition: I.FilterCondition.Equal, value: 'ot-plugin' }
      ]
    })
    console.log(`[Plugin] Found ${res.records.length} plugin objects by unique key 'ot-plugin'`)
    
    // Debug: Show what we found
    if (res.records.length > 0) {
      console.log('[Plugin] Plugin objects found:')
      res.records.forEach((record, index) => {
        console.log(`[Plugin] ${index + 1}. Name: ${record.name}, Type: ${record.type}`)
        console.log(`[Plugin]    Enabled: ${record.relations?.[PLUGIN_RELATIONS.ENABLED]?.[0]?.value}`)
        console.log(`[Plugin]    Has Script: ${!!record.relations?.[PLUGIN_RELATIONS.SCRIPT]?.[0]?.value}`)
      })
    }
    
    // Filter for enabled plugins
    const enabledPlugins = res.records.filter(record => {
      const enabled = record.relations?.[PLUGIN_RELATIONS.ENABLED]?.[0]?.value
      return enabled === true
    })
    
    console.log(`[Plugin] Found ${enabledPlugins.length} enabled plugins`)
    res = { records: enabledPlugins }
    
  } catch (e) {
    console.log('[Plugin] Error searching for plugin objects:', e.message)
    console.log('[Plugin] This might indicate the Plugin type is not properly created')
    res = { records: [] }
  }
  const records = res.records || []

  // plugin API surface
  const plugin: any = {
    find:    api.find.bind(api),
    create:  api.create.bind(api),
    update:  api.update?.bind(api),
    remove:  api.delete?.bind(api),
    open:    api.open.bind(api),
    notify:  (text: string) => Renderer.send('notification', { text }),
    fetch:   typeof fetch === 'function' ? fetch.bind(window) : undefined,
    storage: {
      get: (k: string) => Renderer.send('storeGet', k),
      set: (k: string, v: any) => Renderer.send('storeSet', k, v),
      delete: (k: string) => Renderer.send('storeDelete', k)
    },
    onAppStart,
    onObjectOpen,
    onCollectionViewRender,
    registerSlot,
    registerCommand: ({ id, title, shortcut, handler }: any) => {
      commandHandlers.set(id, handler)
      api.registerCommand?.({ id, title, shortcut })
    },
    React,
    h: React.createElement
  }

  // evaluate scripts
  for (const rec of records) {
    const code = rec.relations?.[PLUGIN_RELATIONS.SCRIPT]?.[0]?.value
    if (typeof code === 'string') {
      try { 
        console.log(`[Plugin] Executing plugin: ${rec.name || 'Unnamed'}`)
        new Function('plugin', code)(plugin) 
      }
      catch (e) { console.error('[Plugin] eval error', e) }
    }
  }

  // run startup hooks
  onAppStartHandlers.forEach(fn => { try { fn() } catch {} })
}
