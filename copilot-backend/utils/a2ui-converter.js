/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — A2UI DECLARATIVE UI CONVERTER (utils/a2ui-converter.js)
 *  ★ CORE FILE ★ — Converts tool and database outputs to safe A2UI v0.9 layout JSON.
 * ==============================================================================
 */

/**
 * Converts a database payload into a flat A2UI v0.9 component adjacency list.
 * Structures layouts using Column and Row; isolates text details inside Card container;
 * maps filter interfaces to interactive ChoicePicker elements.
 *
 * @param {string} surfaceId - Unique ID for the target rendering surface
 * @param {Object} dataPayload - The raw database payload/notes/metadata
 * @returns {Object[]} Flat list of A2UI components
 */
export function convertToA2UI(surfaceId, dataPayload) {
  if (!surfaceId) {
    throw new Error('surfaceId is required for A2UI conversion');
  }
  const components = [];
  
  // Create root container
  const rootId = `${surfaceId}-root`;
  const rootComponent = {
    id: rootId,
    type: 'Column',
    props: {
      spacing: 'large',
      padding: 'medium',
      alignment: 'stretch'
    },
    children: []
  };
  components.push(rootComponent);

  if (!dataPayload) {
    return components;
  }

  // Helper to generate unique component IDs
  let idCounter = 0;
  const nextId = (prefix) => `${surfaceId}-${prefix}-${++idCounter}`;

  // Process dataPayload dynamically
  // 1. If it contains a filter interface, map to ChoicePicker inside a Row
  if (dataPayload.filters || dataPayload.filter) {
    const filter = dataPayload.filters || dataPayload.filter;
    const pickerId = nextId('choice-picker');
    const pickerRowId = nextId('filter-row');

    const options = (filter.options || []).map(opt => {
      if (typeof opt === 'string') {
        return { label: opt, value: opt };
      }
      return opt;
    });

    const pickerComponent = {
      id: pickerId,
      type: 'ChoicePicker',
      props: {
        label: filter.label || 'Filter Options',
        options: options,
        value: filter.selected || filter.value || ''
      }
    };
    
    const pickerRow = {
      id: pickerRowId,
      type: 'Row',
      props: {
        alignment: 'center',
        spacing: 'medium'
      },
      children: [pickerId]
    };

    components.push(pickerComponent, pickerRow);
    rootComponent.children.push(pickerRowId);
  }

  // 2. If it contains items (e.g. study notes, video chapters, segments), layout them in a grid/columns
  if (Array.isArray(dataPayload.items)) {
    const itemsRowId = nextId('items-row-container');
    const itemsRow = {
      id: itemsRowId,
      type: 'Row',
      props: {
        alignment: 'stretch',
        spacing: 'large',
        wrap: true
      },
      children: []
    };
    components.push(itemsRow);
    rootComponent.children.push(itemsRowId);

    dataPayload.items.forEach((item, index) => {
      const cardId = nextId(`item-card-${item.id || index}`);
      const cardTitleId = nextId(`card-title-${item.id || index}`);
      const cardContentId = nextId(`card-content-${item.id || index}`);

      const titleTextComponent = {
        id: cardTitleId,
        type: 'Text',
        props: {
          content: item.title || item.name || `Item ${index + 1}`,
          style: {
            fontSize: '1.2rem',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '8px'
          }
        }
      };

      const contentTextComponent = {
        id: cardContentId,
        type: 'Text',
        props: {
          content: item.content || item.description || item.text || '',
          style: {
            fontSize: '0.95rem',
            color: '#4a4a4a',
            lineHeight: '1.5'
          }
        }
      };

      const cardComponent = {
        id: cardId,
        type: 'Card',
        props: {
          elevation: 'low',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e0e0',
          padding: '16px',
          flexWeight: item.weight || 1
        },
        children: [cardTitleId, cardContentId]
      };

      components.push(titleTextComponent, contentTextComponent, cardComponent);
      itemsRow.children.push(cardId);
    });
  } else if (typeof dataPayload === 'object') {
    // If it's a general key-value or simple object, render it inside a single Card
    const cardId = nextId('detail-card');
    const cardChildren = [];

    const cardComponent = {
      id: cardId,
      type: 'Card',
      props: {
        elevation: 'medium',
        backgroundColor: '#f9f9f9',
        borderRadius: '12px',
        padding: '24px'
      },
      children: cardChildren
    };
    components.push(cardComponent);
    rootComponent.children.push(cardId);

    // Map each primitive key to a text row
    Object.entries(dataPayload).forEach(([key, value]) => {
      if (key !== 'filter' && key !== 'filters' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        const rowId = nextId(`prop-row-${key}`);
        const keyId = nextId(`prop-key-${key}`);
        const valId = nextId(`prop-val-${key}`);

        const keyText = {
          id: keyId,
          type: 'Text',
          props: {
            content: `${key}:`,
            style: { fontWeight: 'semibold', color: '#666666' }
          }
        };

        const valText = {
          id: valId,
          type: 'Text',
          props: {
            content: String(value),
            style: { color: '#222222' }
          }
        };

        const row = {
          id: rowId,
          type: 'Row',
          props: { spacing: 'small', alignment: 'center' },
          children: [keyId, valId]
        };

        components.push(keyText, valText, row);
        cardChildren.push(rowId);
      }
    });
  }

  return components;
}

/**
 * Wraps a database JSON payload and the parsed A2UI representation.
 * Emits a hybrid response schema payload containing both raw database JSON
 * and safe <a2ui-json> UI structural logic blocks.
 *
 * @param {string} surfaceId
 * @param {Object} rawDatabaseJson
 * @param {Object} [dataPayload] - Optional specific payload to convert (defaults to rawDatabaseJson)
 * @returns {Object} Hybrid payload containing raw DB JSON and <a2ui-json> string block
 */
export function wrapHybridResponse(surfaceId, rawDatabaseJson, dataPayload) {
  const payloadToConvert = dataPayload !== undefined ? dataPayload : rawDatabaseJson;
  const a2uiLayout = {
    surfaceId,
    components: convertToA2UI(surfaceId, payloadToConvert)
  };

  const formattedA2uiJsonString = `<a2ui-json>\n${JSON.stringify(a2uiLayout, null, 2)}\n</a2ui-json>`;

  return {
    rawDatabase: rawDatabaseJson,
    a2ui: a2uiLayout,
    a2uiBlock: formattedA2uiJsonString
  };
}
