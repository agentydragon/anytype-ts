// pluginHost.ts
// Minimal JS plugin host for Anytype clients

import React from 'react'
import Renderer from './renderer'
import { C, S, I, U, J, Relation } from 'Lib'

/**
 * Plugin Key Constants
 * 
 * Following KEY_SYSTEM.md conventions:
 * - Type keys use 'ot-{typename}' format for built-in types
 * - Relation keys use snake_case for custom relations
 * - Keys are validated against naming rules
 */
const PLUGIN_CONSTANTS = {
  /**
   * Type Key: 'ot-plugin'
   * Used to identify plugin objects in the system
   */
  TYPE_KEY: J.Constant.typeKey.plugin,
  
  /**
   * Custom Relation Keys for Plugin objects
   */
  RELATIONS: {
    /**
     * 'plugin_script' - Contains the JavaScript code for the plugin
     * Format: LongText (I.RelationType.LongText)
     */
    SCRIPT: 'plugin_script',
    
    /**
     * 'plugin_enabled' - Boolean flag indicating if plugin is active
     * Format: Checkbox (I.RelationType.Checkbox)
     */
    ENABLED: 'plugin_enabled'
  }
} as const


/**
 * Install Plugin schema (type and relations) in Anytype
 * This creates the Plugin object type and its required relations
 * 
 * TRANSACTIONAL APPROACH:
 * This function follows a transactional pattern where either ALL operations succeed
 * or we abort and rollback any partial changes. We progressively build up a rollback
 * stack as we create objects, and if any step fails, we execute the rollback stack
 * to clean up what we've created so far.
 * 
 * Steps:
 * 1. Check if Plugin type already exists (if so, skip installation)
 * 2. Create Plugin relations (with rollback capability)
 * 3. Create Plugin type (with rollback capability)
 * 4. Link relations to type (with rollback capability)
 * 5. Create default template (with rollback capability)
 * 6. Assign template to type (with rollback capability)
 * 
 * If any step fails, we rollback all previous steps and reject the promise.
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
    
    
    // Rollback stack - tracks objects created so we can delete them if something fails
    const rollbackStack: Array<{ type: 'relation' | 'type' | 'template', id: string }> = []
    
    // Helper function to execute rollback
    const executeRollback = async (reason: string) => {
      console.error(`[Plugin] Schema installation failed: ${reason}`)
      console.log(`[Plugin] Executing rollback for ${rollbackStack.length} objects...`)
      
      // Execute rollback in reverse order
      for (let i = rollbackStack.length - 1; i >= 0; i--) {
        const item = rollbackStack[i]
        try {
          console.log(`[Plugin] Rolling back ${item.type}: ${item.id}`)
          await new Promise<void>((resolve, reject) => {
            C.ObjectListDelete([item.id], (response: any) => {
              if (response.error && response.error.code !== 0) {
                console.error(`[Plugin] Failed to rollback ${item.type} ${item.id}:`, response.error)
                // Continue with rollback even if individual deletes fail
                resolve()
              } else {
                console.log(`[Plugin] Successfully rolled back ${item.type}: ${item.id}`)
                resolve()
              }
            })
          })
        } catch (error) {
          console.error(`[Plugin] Error during rollback of ${item.type} ${item.id}:`, error)
          // Continue with rollback even if individual operations fail
        }
      }
      
      console.log('[Plugin] Rollback completed')
      reject(new Error(reason))
    }

    // First, check if Plugin type already exists
    try {
      // Check if Plugin type already exists using correct search API
      const existingByKey = await new Promise<any>((resolve, reject) => {
        const filters = [
          { relationKey: 'uniqueKey', condition: I.FilterCondition.Equal, value: PLUGIN_CONSTANTS.TYPE_KEY },
          { relationKey: 'resolvedLayout', condition: I.FilterCondition.Equal, value: I.ObjectLayout.Type }
        ]
        const sorts: any[] = []
        const keys = ['id', 'name', 'uniqueKey', 'resolvedLayout']
        
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
      await executeRollback(`Cannot verify if Plugin type already exists: ${e?.message || e}`)
      return
    }

    // Step 2: Create Plugin relations
    try {
      const relationIds: string[] = []
      
      const relations = [
        {
          name: 'Script',
          key: PLUGIN_CONSTANTS.RELATIONS.SCRIPT,
          details: {
            name: 'Script',
            relationFormat: I.RelationType.LongText,
            origin: I.ObjectOrigin.Api,
            type: J.Constant.typeKey.relation,
            apiObjectKey: PLUGIN_CONSTANTS.RELATIONS.SCRIPT
          }
        },
        {
          name: 'Enabled',
          key: PLUGIN_CONSTANTS.RELATIONS.ENABLED,
          details: {
            name: 'Enabled',
            relationFormat: I.RelationType.Checkbox,
            origin: I.ObjectOrigin.Api,
            type: J.Constant.typeKey.relation,
            apiObjectKey: PLUGIN_CONSTANTS.RELATIONS.ENABLED
          }
        }
      ]

      // Create relations sequentially to ensure proper error handling
      for (let i = 0; i < relations.length; i++) {
        const relation = relations[i]
        try {
          console.log(`[Plugin] Creating relation: ${relation.name}`)
          const relationId = await new Promise<string>((resolve, reject) => {
            C.ObjectCreateRelation(relation.details, spaceId, (response: any) => {
              if (response.error && response.error.code !== 0) {
                reject(new Error(`Failed to create relation ${relation.name}: ${response.error.description || 'Unknown error'}`))
              } else {
                console.log(`[Plugin] Created relation: ${relation.name} with ID: ${response.objectId}`)
                resolve(response.objectId)
              }
            })
          })
          
          relationIds.push(relationId)
          rollbackStack.push({ type: 'relation', id: relationId })
          
        } catch (error) {
          await executeRollback(`Failed to create relation ${relation.name}: ${error.message}`)
          return
        }
      }
      
      console.log(`[Plugin] All relations created. IDs: ${relationIds}`)
      
      // Step 3: Create Plugin object type
      let pluginTypeId: string
      try {
        console.log('[Plugin] Creating Plugin type')
        pluginTypeId = await new Promise<string>((resolve, reject) => {
          const pluginTypeDetails = {
            name: 'Plugin',
            pluralName: 'Plugins',
            layout: I.ObjectLayout.Page,
            origin: I.ObjectOrigin.Api,
            uniqueKey: PLUGIN_CONSTANTS.TYPE_KEY,
            iconEmoji: '🔌'
          }
          
          C.ObjectCreateObjectType(pluginTypeDetails, [], spaceId, (response: any) => {
            if (response.error && response.error.code !== 0) {
              reject(new Error(`Failed to create Plugin type: ${response.error.description || 'Unknown error'}`))
            } else {
              console.log('[Plugin] Created Plugin object type:', response.objectId)
              resolve(response.objectId)
            }
          })
        })
        
        rollbackStack.push({ type: 'type', id: pluginTypeId })
        
      } catch (error) {
        await executeRollback(`Failed to create Plugin type: ${error.message}`)
        return
      }
      
      // Step 4: Link relations to the Plugin type
      try {
        console.log('[Plugin] Linking relations to Plugin type')
        await new Promise<void>((resolve, reject) => {
          C.ObjectTypeRelationAdd(pluginTypeId, [PLUGIN_CONSTANTS.RELATIONS.SCRIPT, PLUGIN_CONSTANTS.RELATIONS.ENABLED], (response: any) => {
            if (response.error && response.error.code !== 0) {
              reject(new Error(`Failed to link relations to Plugin type: ${response.error.description || 'Unknown error'}`))
            } else {
              console.log('[Plugin] Successfully linked relations to Plugin type')
              resolve()
            }
          })
        })
        
      } catch (error) {
        await executeRollback(`Failed to link relations to Plugin type: ${error.message}`)
        return
      }
      
      // Step 5: Create default template
      let templateId: string
      try {
        console.log('[Plugin] Creating default template')
        templateId = await new Promise<string>((resolve, reject) => {
          const templateDetails = {
            name: 'Default Plugin Template',
            targetObjectType: pluginTypeId,
            featuredRelations: relationIds,
            [PLUGIN_CONSTANTS.RELATIONS.SCRIPT]: '// Write your plugin code here\n// Example:\n// plugin.onAppStart(() => {\n//   plugin.notify("Plugin loaded!");\n// });',
            [PLUGIN_CONSTANTS.RELATIONS.ENABLED]: false
          }
          
          C.ObjectCreate(templateDetails, [], '', J.Constant.typeKey.template, spaceId, (response: any) => {
            if (response.error && response.error.code !== 0) {
              reject(new Error(`Failed to create Plugin template: ${response.error.description || 'Unknown error'}`))
            } else {
              console.log('[Plugin] Created Plugin template:', response.objectId)
              resolve(response.objectId)
            }
          })
        })
        
        rollbackStack.push({ type: 'template', id: templateId })
        
      } catch (error) {
        await executeRollback(`Failed to create Plugin template: ${error.message}`)
        return
      }
      
      // Step 6: Assign template to type
      try {
        console.log('[Plugin] Assigning template to Plugin type')
        await new Promise<void>((resolve, reject) => {
          C.ObjectListSetDetails([pluginTypeId], [{ defaultTemplateId: templateId }], (response: any) => {
            if (response.error && response.error.code !== 0) {
              reject(new Error(`Failed to assign template to Plugin type: ${response.error.description || 'Unknown error'}`))
            } else {
              console.log('[Plugin] Successfully assigned template to Plugin type')
              resolve()
            }
          })
        })
        
      } catch (error) {
        await executeRollback(`Failed to assign template to Plugin type: ${error.message}`)
        return
      }
      
      console.log('[Plugin] Plugin schema installation completed successfully')
      resolve()
      
    } catch (error) {
      await executeRollback(`Unexpected error during schema installation: ${error.message}`)
      return
    }
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
 * Reset the plugin system initialization flag - useful for testing
 */
export function resetPluginSystem() {
  isInitialized = false
  console.log('[Plugin] Plugin system reset, can be reinitialized')
}

/**
 * Delete all plugin-related objects (Plugin type, template, instances, and relations)
 * This is for testing purposes only
 */
export async function deleteAllPluginObjects(spaceId?: string): Promise<{ success: boolean, errors: string[], results: any }> {
  return new Promise(async (resolve) => {
    const actualSpaceId = spaceId || S.Common.space || ''
    const errors: string[] = []
    const results: any = {
      instances: { found: 0, deleted: 0, failed: 0 },
      templates: { found: 0, deleted: 0, failed: 0 },
      relations: { found: 0, deleted: 0, failed: 0 },
      types: { found: 0, deleted: 0, failed: 0 }
    }
    
    if (!actualSpaceId) {
      errors.push('No space available')
      resolve({ success: false, errors, results })
      return
    }

    console.log('[Plugin] Starting deletion of all plugin objects...')
    
    try {
      // Step 1: Find and delete all Plugin instances
      try {
        const pluginInstances = await new Promise<any>((resolve, reject) => {
          const filters = [
            { relationKey: 'type.uniqueKey', condition: I.FilterCondition.Equal, value: PLUGIN_CONSTANTS.TYPE_KEY }
          ]
          const sorts: any[] = []
          const keys = ['id', 'name', 'type']
          
          C.ObjectSearch(actualSpaceId, filters, sorts, keys, '', 0, 100, (response: any) => {
            if (response.error && response.error.code !== 0) {
              reject(new Error(response.error.description || 'Search failed'))
            } else {
              resolve(response)
            }
          })
        })

        results.instances.found = pluginInstances.records?.length || 0
        console.log(`[Plugin] Found ${results.instances.found} Plugin instances to delete`)
        
        // Delete each Plugin instance
        for (const instance of pluginInstances.records || []) {
          console.log(`[Plugin] Deleting Plugin instance: ${instance.name} (${instance.id})`)
          try {
            await new Promise<void>((resolve, reject) => {
              C.ObjectListDelete([instance.id], (response: any) => {
                if (response.error && response.error.code !== 0) {
                  reject(new Error(response.error.description || 'Unknown error'))
                } else {
                  resolve()
                }
              })
            })
            results.instances.deleted++
            console.log(`[Plugin] Deleted Plugin instance: ${instance.id}`)
          } catch (error) {
            results.instances.failed++
            const errorMsg = `Failed to delete Plugin instance ${instance.name} (${instance.id}): ${error.message}`
            errors.push(errorMsg)
            console.error(`[Plugin] ${errorMsg}`)
          }
        }
      } catch (error) {
        const errorMsg = `Failed to search for Plugin instances: ${error.message}`
        errors.push(errorMsg)
        console.error(`[Plugin] ${errorMsg}`)
      }

      // Step 2: Find and delete Plugin templates
      try {
        const pluginTemplates = await new Promise<any>((resolve, reject) => {
          const filters = [
            { relationKey: 'type.uniqueKey', condition: I.FilterCondition.Equal, value: J.Constant.typeKey.template },
            { relationKey: 'name', condition: I.FilterCondition.Like, value: 'Plugin' }
          ]
          const sorts: any[] = []
          const keys = ['id', 'name', 'type', 'targetObjectType']
          
          C.ObjectSearch(actualSpaceId, filters, sorts, keys, '', 0, 100, (response: any) => {
            if (response.error && response.error.code !== 0) {
              reject(new Error(response.error.description || 'Search failed'))
            } else {
              resolve(response)
            }
          })
        })

        results.templates.found = pluginTemplates.records?.length || 0
        console.log(`[Plugin] Found ${results.templates.found} Plugin templates to delete`)
        
        // Delete each Plugin template
        for (const template of pluginTemplates.records || []) {
          console.log(`[Plugin] Deleting Plugin template: ${template.name} (${template.id})`)
          try {
            await new Promise<void>((resolve, reject) => {
              C.ObjectListDelete([template.id], (response: any) => {
                if (response.error && response.error.code !== 0) {
                  reject(new Error(response.error.description || 'Unknown error'))
                } else {
                  resolve()
                }
              })
            })
            results.templates.deleted++
            console.log(`[Plugin] Deleted Plugin template: ${template.id}`)
          } catch (error) {
            results.templates.failed++
            const errorMsg = `Failed to delete Plugin template ${template.name} (${template.id}): ${error.message}`
            errors.push(errorMsg)
            console.error(`[Plugin] ${errorMsg}`)
          }
        }
      } catch (error) {
        const errorMsg = `Failed to search for Plugin templates: ${error.message}`
        errors.push(errorMsg)
        console.error(`[Plugin] ${errorMsg}`)
      }

      // Step 3: Find and delete Plugin relations
      try {
        const pluginRelations = await new Promise<any>((resolve, reject) => {
          const filters = [
            { relationKey: 'resolvedLayout', condition: I.FilterCondition.Equal, value: I.ObjectLayout.Relation },
            { relationKey: 'relationKey', condition: I.FilterCondition.In, value: [PLUGIN_CONSTANTS.RELATIONS.SCRIPT, PLUGIN_CONSTANTS.RELATIONS.ENABLED] }
          ]
          const sorts: any[] = []
          const keys = ['id', 'name', 'relationKey', 'resolvedLayout']
          
          C.ObjectSearch(actualSpaceId, filters, sorts, keys, '', 0, 100, (response: any) => {
            if (response.error && response.error.code !== 0) {
              reject(new Error(response.error.description || 'Search failed'))
            } else {
              resolve(response)
            }
          })
        })

        results.relations.found = pluginRelations.records?.length || 0
        console.log(`[Plugin] Found ${results.relations.found} Plugin relations to delete`)
        
        // Delete each Plugin relation
        for (const relation of pluginRelations.records || []) {
          console.log(`[Plugin] Deleting Plugin relation: ${relation.name} (${relation.id}) - ${relation.uniqueKey}`)
          try {
            await new Promise<void>((resolve, reject) => {
              C.ObjectListDelete([relation.id], (response: any) => {
                if (response.error && response.error.code !== 0) {
                  reject(new Error(response.error.description || 'Unknown error'))
                } else {
                  resolve()
                }
              })
            })
            results.relations.deleted++
            console.log(`[Plugin] Deleted Plugin relation: ${relation.id}`)
          } catch (error) {
            results.relations.failed++
            const errorMsg = `Failed to delete Plugin relation ${relation.name} (${relation.id}): ${error.message}`
            errors.push(errorMsg)
            console.error(`[Plugin] ${errorMsg}`)
          }
        }
      } catch (error) {
        const errorMsg = `Failed to search for Plugin relations: ${error.message}`
        errors.push(errorMsg)
        console.error(`[Plugin] ${errorMsg}`)
      }

      // Step 4: Find and delete Plugin type
      try {
        const pluginType = await new Promise<any>((resolve, reject) => {
          const filters = [
            { relationKey: 'uniqueKey', condition: I.FilterCondition.Equal, value: PLUGIN_CONSTANTS.TYPE_KEY },
            { relationKey: 'resolvedLayout', condition: I.FilterCondition.Equal, value: I.ObjectLayout.Type }
          ]
          const sorts: any[] = []
          const keys = ['id', 'name', 'uniqueKey', 'resolvedLayout']
          
          C.ObjectSearch(actualSpaceId, filters, sorts, keys, '', 0, 10, (response: any) => {
            if (response.error && response.error.code !== 0) {
              reject(new Error(response.error.description || 'Search failed'))
            } else {
              resolve(response)
            }
          })
        })

        results.types.found = pluginType.records?.length || 0
        console.log(`[Plugin] Found ${results.types.found} Plugin types to delete`)
        
        // Delete the Plugin type
        for (const type of pluginType.records || []) {
          console.log(`[Plugin] Deleting Plugin type: ${type.name} (${type.id})`)
          try {
            await new Promise<void>((resolve, reject) => {
              C.ObjectListDelete([type.id], (response: any) => {
                if (response.error && response.error.code !== 0) {
                  reject(new Error(response.error.description || 'Unknown error'))
                } else {
                  resolve()
                }
              })
            })
            results.types.deleted++
            console.log(`[Plugin] Deleted Plugin type: ${type.id}`)
          } catch (error) {
            results.types.failed++
            const errorMsg = `Failed to delete Plugin type ${type.name} (${type.id}): ${error.message}`
            errors.push(errorMsg)
            console.error(`[Plugin] ${errorMsg}`)
          }
        }
      } catch (error) {
        const errorMsg = `Failed to search for Plugin types: ${error.message}`
        errors.push(errorMsg)
        console.error(`[Plugin] ${errorMsg}`)
      }

      // Reset the plugin system so it can be reinitialized
      resetPluginSystem()
      
      const success = errors.length === 0
      if (success) {
        console.log('[Plugin] Successfully deleted all plugin objects')
      } else {
        console.error(`[Plugin] Completed deletion with ${errors.length} errors`)
      }
      
      resolve({ success, errors, results })
      
    } catch (error) {
      const errorMsg = `Unexpected error during plugin deletion: ${error.message}`
      errors.push(errorMsg)
      console.error(`[Plugin] ${errorMsg}`)
      resolve({ success: false, errors, results })
    }
  })
}

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
    
    // Add the testing delete button to the UI
    registerTestingButton()
    
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
 * Register a testing button that allows deleting all plugin objects
 * This is added by the plugin host itself for development purposes
 */
function registerTestingButton() {
  registerSlot('ObjectHeaderRight', (props: any) => {
    return React.createElement('button', {
      className: 'btn btn-sm btn-outline-danger',
      style: {
        marginLeft: '8px',
        padding: '4px 8px',
        fontSize: '12px',
        border: '1px solid #dc3545',
        color: '#dc3545',
        backgroundColor: 'transparent',
        borderRadius: '4px',
        cursor: 'pointer'
      },
      onClick: async () => {
        if (confirm('Are you sure you want to delete ALL plugin objects (type, template, instances, relations)? This cannot be undone.')) {
          try {
            console.log('[Plugin] Delete button clicked - starting deletion...')
            const result = await deleteAllPluginObjects()
            
            // Build detailed result message
            const { success, errors, results } = result
            let message = `Plugin Deletion Results:\n\n`
            
            // Add summary
            message += `✅ Plugin Instances: ${results.instances.deleted}/${results.instances.found} deleted`
            if (results.instances.failed > 0) message += ` (${results.instances.failed} failed)`
            message += `\n`
            
            message += `✅ Plugin Templates: ${results.templates.deleted}/${results.templates.found} deleted`
            if (results.templates.failed > 0) message += ` (${results.templates.failed} failed)`
            message += `\n`
            
            message += `✅ Plugin Relations: ${results.relations.deleted}/${results.relations.found} deleted`
            if (results.relations.failed > 0) message += ` (${results.relations.failed} failed)`
            message += `\n`
            
            message += `✅ Plugin Types: ${results.types.deleted}/${results.types.found} deleted`
            if (results.types.failed > 0) message += ` (${results.types.failed} failed)`
            message += `\n`
            
            // Add error details if any
            if (errors.length > 0) {
              message += `\n⚠️ Errors encountered:\n`
              errors.forEach((error, index) => {
                message += `${index + 1}. ${error}\n`
              })
            }
            
            if (success) {
              message += `\n✅ All plugin objects deleted successfully!`
              console.log('[Plugin] All plugin objects deleted via testing button')
            } else {
              message += `\n⚠️ Deletion completed with errors. See console for details.`
              console.error('[Plugin] Plugin deletion completed with errors:', errors)
            }
            
            alert(message)
            
          } catch (error) {
            const errorMsg = `Unexpected error during plugin deletion: ${error.message}`
            console.error('[Plugin] Failed to delete plugin objects:', error)
            alert(`Failed to delete plugin objects.\n\nError: ${errorMsg}\n\nCheck console for details.`)
          }
        }
      },
      title: 'Delete all plugin objects (testing)'
    }, '🗑️ Plugins')
  })
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
        { relationKey: 'type.uniqueKey', condition: I.FilterCondition.Equal, value: PLUGIN_CONSTANTS.TYPE_KEY }
      ]
    })
    console.log(`[Plugin] Found ${res.records.length} plugin objects by unique key '${PLUGIN_CONSTANTS.TYPE_KEY}'`)
    
    // Debug: Show what we found
    if (res.records.length > 0) {
      console.log('[Plugin] Plugin objects found:')
      res.records.forEach((record, index) => {
        console.log(`[Plugin] ${index + 1}. Name: ${record.name}, Type: ${record.type}`)
        console.log(`[Plugin]    Enabled: ${record.relations?.[PLUGIN_CONSTANTS.RELATIONS.ENABLED]?.[0]?.value}`)
        console.log(`[Plugin]    Has Script: ${!!record.relations?.[PLUGIN_CONSTANTS.RELATIONS.SCRIPT]?.[0]?.value}`)
      })
    }
    
    // Filter for enabled plugins
    const enabledPlugins = res.records.filter(record => {
      const enabled = record.relations?.[PLUGIN_CONSTANTS.RELATIONS.ENABLED]?.[0]?.value
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
    const code = rec.relations?.[PLUGIN_CONSTANTS.RELATIONS.SCRIPT]?.[0]?.value
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
