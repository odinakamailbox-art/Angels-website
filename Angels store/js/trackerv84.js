; (() => {
  const Tracker = {
    init: (config) => {
      Tracker.config = config
      Tracker.log(`Initialised`, 'log')
      Tracker.nonce = crypto.randomUUID()

      window.addEventListener('load', () => Tracker.setup())
    },
    refresh: () => {
      Tracker.setup()
    },
    setup: () => {
      Tracker.assignTracker()
      Tracker.getPageData()
      Tracker.eventBind()
      Tracker.handlers.pageVisit()
    },
    assignTracker: () => {
      window.Tracker = Object.assign(Tracker, window.Tracker)
    },
    handlerCaller: (el) => { },
    urlEvent: () => {
      if (!Tracker.config.watchers) {
        return
      }
      const keys = Object?.keys(Tracker.config.watchers.params)
      const searchParams = new URLSearchParams(window.location.search)
      keys.map((key) => {
        if (
          searchParams.get(Tracker?.config?.watchers?.params[key].paramName)
        ) {
          Tracker.handlers[Tracker?.config?.watchers?.params[key].eventName]()
          let url = new URL(window?.location?.href)
          url.searchParams.delete(
            Tracker?.config?.watchers?.params[key]?.paramName
          )
          history.replaceState(history.state, '', url.href)
        }
      })
    },
    eventBind: (el) => {
      Tracker.urlEvent()
      let nodes = []

      if (el) {
        nodes = [el]
      } else {
        nodes = [
          ...document.querySelectorAll(`[${Tracker.config.selectors.track}]`)
        ]
      }
      nodes.map((node) => {
        let el = node,
          handler = el.getAttribute(Tracker.config.selectors.track),
          eventType = el.getAttribute(Tracker.config.selectors.type)
            ? el.getAttribute(Tracker.config.selectors.type).split('|')
            : ['click']
        if (typeof Tracker.handlers[handler] !== 'undefined') {
          if (eventType[0] === 'impression') {
            const observer = new IntersectionObserver((entries) => {
              entries.forEach((entry) => {
                if (entry.isIntersecting) {
                  Tracker.handlers[handler](el)
                }
              })
            })
            observer.observe(el)
          } else if (eventType[0] === 'onload') {
            Tracker.handlers[handler](el)
          } else {
            el.addEventListener(eventType, Tracker.handlers[handler])
          }
        } else {
          Tracker.log(`Hanlder ${handler} not found on element: %o`, node)
        }
      })
    },
    getPageData: () => {
      const currencyEl = document.querySelector(
        `[${Tracker.config.selectors.currency}]`
      )
      Tracker.page = {}
      if (currencyEl) {
        if (
          window.Tracker.store.currency !==
          currencyEl.getAttribute(Tracker?.config?.selectors?.currency)
        ) {
          Tracker.store.set(
            'currency',
            currencyEl.getAttribute(Tracker?.config?.selectors?.currency)
          )
        }
      } else {
        Tracker.log(
          `Required attribute ${Tracker?.config?.selectors?.currency} not found. Include ${Tracker.config.selectors.currency}="GBP" (for e.g.) to an element in the DOM.`
        )
      }
    },
    getAttributes: (el) => {
      const target = el.currentTarget
      const store = target?.getAttribute(Tracker.config.selectors.store)
      const type = target?.getAttribute(Tracker.config.selectors.type)
      const track = target?.getAttribute(Tracker.config.selectors.track)
      return { store, type, track }
    },
    push: (obj, config) => {
      Tracker.log(`Pushed event: ${JSON.stringify(obj)}`, 'log')
      if (window.dataLayer) {
        if (config?.commerce) {
          window.dataLayer.push({ commerce: true })
        }
        window.dataLayer.push(obj)
      }
    },
    marshalPubSub: (
      operationName,
      url,
      eventData,
      legacyRayId,
      experiments
    ) => {
      const rayId =
        legacyRayId || Tracker.store.get('rayId')?.value || 'unknown'

      const { origin: eventOrigin, ...restEventData } = eventData

      const legacyData = {
        ...restEventData,
        ray_ids: [rayId],
        nonce: Tracker.nonce,
        server: {
          elysium_version: Tracker.trackApiConfig.elysium_config.version
        },
        request: { start_timestamp: Date.now(), url: url },
        origin: { referrer: document.referrer, ...(eventOrigin || {}) },
        property: {
          site_id: Tracker.trackApiConfig.elysium_config.site_id,
          channel: Tracker.trackApiConfig.elysium_config.channel,
          subsite: Tracker.trackApiConfig.elysium_config.subsite,
          locale: Tracker.store.get('locale')?.value
        },
        experiments
      }
      const basket = Tracker.store.get('basket')
      const basketItems = Tracker.getAllBasketItems(basket)
      const cart = {
        items: basketItems?.map((item) => {
          const itemId = item?.id?.includes('~')
            ? item?.id?.split('~')?.[1]
            : item?.id
          return {
            product_group: {
              id: parseInt(itemId),
              selected_variant: {
                price: {
                  currency: Tracker.store.get('currency'),
                  value: parseFloat(item.product.price?.price?.amount)
                },
                sku: parseInt(item.product.product?.sku)
              },
              total_variants: item.product.product?.variants?.length || null
            },
            quantity: parseInt(item.quantity)
          }
        }),
        total_size: basket?.totalQuantity || 0,
        total_price: {
          currency: Tracker.store.get('currency'),
          value: parseFloat(basket?.chargePrice?.amount)
        }
      }

      if (cart.items?.length) {
        legacyData.cart = cart
      }

      const payload = {
        operationName: operationName,
        metadata: {},
        path: url,
        version: 'altitude',
        rayId: rayId,
        currency:
          Tracker.store.get('currency') || Tracker.store.get('curr')?.value,
        shippingDestination: Tracker.store.get('ship')?.value,
        locale: Tracker.store.get('locale')?.value
      }

      if (Object?.keys(legacyData).length) payload.legacy = legacyData
      return payload
    },
    pushToTrackAPI: async (payload) => {
      const trackUrl = Tracker.trackApiConfig.trackAPIUrl
      if (!Tracker.config.dev && !trackUrl) return
      const dataBlob = new Blob([JSON.stringify(payload)], {
        type: 'application/json'
      })
      navigator.sendBeacon(trackUrl, dataBlob)
      window.debugger &&
        window.debugger.push({
          message: payload?.legacy?.event?.type,
          snippet: JSON.stringify(payload),
          type: 'event'
        })
    },
    sendPubSubEvent: async (
      operationName,
      eventData,
      legacyRayId = null,
      recommendationContext = null,
      recommendationSlotIndex = null,
      giftBoxedSkus = null
    ) => {
      const experiments = []
      if (window.__EXPERIMENTS__) {
        const chunks = window.__EXPERIMENTS__?.split(',')
        chunks?.forEach((pair) => {
          const [name, value] = pair?.split(':')
          if (name && value) {
            experiments.push({ name, value })
          }
        })
      }

      const requestUrl = new URL(window.location)
      if (recommendationContext) {
        requestUrl.searchParams.set('rctxt', recommendationContext)
      }

      if (recommendationSlotIndex) {
        requestUrl.searchParams.set(
          'sponsoredAdsPLPIndex',
          recommendationSlotIndex
        )
      }

      if (giftBoxedSkus) {
        requestUrl.searchParams.set('giftBoxedSkus', giftBoxedSkus)
      }

      const payload = Tracker.marshalPubSub(
        operationName,
        requestUrl.pathname + requestUrl.search,
        eventData,
        legacyRayId,
        experiments
      )

      return Tracker.pushToTrackAPI(payload)
    },
    log: (message, type = 'warn') => {
      type === 'warn' && console.warn('[Tracker]: %s', message)
      type === 'log' && console.debug('[Tracker]: %s', message)
    },
    translateTarget: (e) => {
      if (e instanceof Event) {
        return e.currentTarget.getAttribute(Tracker.config.selectors?.store)
      } else if (e instanceof HTMLElement) {
        return e.getAttribute(Tracker.config.selectors?.store)
      } else if (e?.store) {
        return e?.store
      } else {
        return e
      }
    },
    handlers: {
      performanceData: (CWVObject, perfDataObject) => {
        const experiments = []
        if (window.__EXPERIMENTS__) {
          const chunks = window.__EXPERIMENTS__?.split(',')
          chunks?.forEach((pair) => {
            const [name, value] = pair?.split(':')
            if (name && value) {
              experiments.push({ name, value })
            }
          })
        }
        const perfData = {
          request: {
            server_timestamp: null,
            client_timestamp: new Date(Date.now()).toISOString(),
            url: window.location.href
          },
          experiments: experiments,
          errors: [{ type: null, label: null }],
          timing: {
            backend_load_time:
              perfDataObject?.navigationTiming?.backendLoadTime,
            cache_time: perfDataObject?.navigationTiming?.cacheTime,
            connection_time: perfDataObject?.navigationTiming?.connectionTime,
            dns_time: perfDataObject?.navigationTiming?.dnsTime,
            dom_interactive_time:
              perfDataObject?.navigationTiming?.domInteractiveTime,
            dom_parsing_time: perfDataObject?.navigationTiming?.domParsingTime,
            dom_ready_time: perfDataObject?.navigationTiming?.domReadyTime,
            first_paint_time: perfDataObject?.navigationTiming?.firstPaintTime,
            frontend_load_time:
              perfDataObject?.navigationTiming?.frontendLoadTime,
            load_event_time: perfDataObject?.navigationTiming?.loadEventTime,
            navigation_time: perfDataObject?.navigationTiming?.navigationTime,
            redirect_time: perfDataObject?.navigationTiming?.redirectTime,
            first_contentful_paint_time: CWVObject?.fcp || null,
            first_input_delay: CWVObject?.fid || null,
            largest_contentful_paint_time: CWVObject?.lcp || null,
            first_byte_time: CWVObject?.ttfb || null,
            interaction_to_next_paint_time: CWVObject?.inp || null
          },
          score: { cumulative_layout_shift: CWVObject?.cls || null },
          nonce: Tracker.nonce,
          device: perfDataObject?.device,
          page: perfDataObject?.page,
          network: perfDataObject?.network,
          abtasty: [
            {
              name: null,
              time_to_first_byte: null,
              transfer: null,
              total: null,
              encoded_file_size: null
            }
          ]
        }
        Tracker.pushToTrackAPI({
          operationName: 'perfData',
          metaData: { destination: 'performanceData' },
          eventData: perfData
        })
      },
      // Page Load
      pageLoad: (e) => {
        Tracker.push(window?.Tracker?.store?.pageInfo)
      },

      // Cookie Consent
      cookieModalOpen: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'cookie_modal_shown',
          action: 'shown',
          eventData: {
            eventCategory: 'Cookie Modal',
            eventAction: 'Shown',
            eventLabel: 'Accept Cookie Button',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      cookieModalAccepted: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'cookie_modal_clicked',
          action: 'accepted all',
          eventData: {
            eventCategory: 'Cookie Modal',
            eventAction: 'Accept All',
            eventLabel: 'Accept Cookie Button',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },
      cookieModalRejected: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'cookie_modal_clicked',
          action: 'reject all',
          eventData: {
            eventCategory: 'Cookie Modal',
            eventAction: 'Reject All',
            eventLabel: 'Reject Cookie Button',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },
      cookieSet: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'cookie_modal_clicked',
          action: `set preference to be ${el}`,
          eventData: {
            eventCategory: 'Cookie Modal',
            eventAction: 'Set preference',
            eventLabel: 'Set Preference Button',
            eventValue: el,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      // Site Settings modal
      siteSettingsSet: (trackerParam) => {
        const elyEvent = {
          event: 'settings_changed',
          shipping_destination: trackerParam.shipping_destination,
          region_setting: trackerParam.region_setting,
          currency_setting: trackerParam.currency_setting
        }
        Tracker.push(elyEvent)
      },
      // ReEngagement Modal
      reEngOpen: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'newsletter_signup_shown',
          eventData: {
            eventCategory: 'reEngagement Tooltip Modal',
            eventAction: 'Shown',
            eventLabel: 'reEngagement Modal Message',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      reEngClicked: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'newsletter_signup_clicked',
          eventData: {
            eventCategory: 'reEngagement Tooltip Modal',
            eventAction: 'Clicked',
            eventLabel: 'Continue Modal Button',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      // Email Signup
      newsletterSignup: (params) => {
        const status = params?.status
        const location = params?.location || window?.location?.pathname

        const elyEvent = {
          event: 'customEvent',
          event_name: 'newsletter_signup_complete',
          eventData: {
            eventCategory: 'newsletter',
            eventAction: status,
            eventPage: location
          }
        }

        Tracker.push(elyEvent)
      },

      // Widget Track
      widgetTrack: (e) => {
        const widgetDescription = e.parentElement.dataset.description
        const widgetId = e.parentElement.dataset.id

        const ecommerceEvent = {
          event: 'ecom_event',
          event_name: 'view_promotion',
          ecommerce: {
            creative_name: Tracker.store.get('widgets')[widgetId] ?? '',
            creative_slot: '',
            promotion_id: widgetId,
            promotion_name: widgetDescription,
            promotion_page: window?.location?.pathname
          }
        }
        Tracker.push(ecommerceEvent, { commerce: true })
      },

      widgetClick: (el) => {
        if (!el) return

        const sponsoredElement = el.target.closest('[id^="sponsored-product-"]')

        if (sponsoredElement) {
          // can extend for more ads using /^sponsored-product-(list|pdp|banner)-(\d+)$/
          const SPONSORED_PRODUCT_REGEX = /^sponsored-product-(list)-(\d+)$/
          const sponsoredProductMatch = sponsoredElement.id.match(
            SPONSORED_PRODUCT_REGEX
          )

          if (sponsoredProductMatch) {
            const [, type, slotNumber] = sponsoredProductMatch

            if (!slotNumber || !type) {
              return
            }

            const sponsoredAdsMap = {
              list: 'sponsoredProductPLP'
            }

            const getSponsoredAdsExperimentByType = (type) => {
              if (!window.__EXPERIMENTS__) return null

              const typeToExperimentMap = {
                list: 'sponsored_ads_slots_plp'
              }

              const experimentName = typeToExperimentMap[type]
              if (!experimentName) return null

              const chunks = window.__EXPERIMENTS__.split(',')
              for (const pair of chunks) {
                const [name, value] = pair.split(':')
                if (name === experimentName && value) {
                  return { name, value }
                }
              }
              return null
            }

            let promotionName = ''
            let promotionId = ''

            const experiment = getSponsoredAdsExperimentByType(type)
            if (experiment) {
              promotionName = experiment.name
              promotionId = experiment.value
            }

            const ecommerceEvent = {
              event: 'ecom_event',
              event_name: 'select_promotion',
              ecommerce: {
                creative_name: sponsoredAdsMap[type],
                creative_slot: slotNumber,
                promotion_id: promotionId,
                promotion_name: promotionName,
                promotion_page: window?.location?.pathname
              }
            }

            Tracker.push(ecommerceEvent, { commerce: true })
            return
          }
        }

        let widget = Tracker.translateTarget(el)
        const widgetContainer = el?.target?.closest('.widgets')
        const widgetDescription = widgetContainer?.dataset?.description
        const widgetId = widgetContainer?.dataset?.id

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'widget_clicked',
          component: widget,
          widget_id: widgetId,
          eventData: {
            eventCategory: 'Widget Track',
            eventAction: 'clicked',
            eventLabel: widget,
            eventLabelValue: widgetId,
            eventPage: window?.location?.pathname
          }
        }

        const ecommerceEvent = {
          event: 'ecom_event',
          event_name: 'select_promotion',
          ecommerce: {
            creative_name: Tracker.store.get('widgets')[widgetId] ?? '',
            creative_slot: '',
            promotion_id: widgetId,
            promotion_name: widgetDescription,
            promotion_page: window?.location?.pathname
          }
        }

        if (widget !== 'ProductListWidget') {
          Tracker.push(elyEvent)
          Tracker.push(ecommerceEvent, { commerce: true })
        }
      },

      // Navigation
      navigationHeader: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'navigation_header',
          action: `Clicked ${window.tenantConfig?.application?.siteName}`,
          eventData: {
            eventCategory: 'Navigation Header',
            eventAction: `Clicked ${window.tenantConfig?.application?.siteName}`,
            eventLabel: window.tenantConfig?.application?.livedomain,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      navigationMenu: (el) => {
        const mainCategory = el.target.innerText

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'navigation_main_category',
          action: `Clicked ${mainCategory}`,
          eventData: {
            eventCategory: 'Navigation Header',
            eventAction: `Clicked ${mainCategory}`
          }
        }
        Tracker.push(elyEvent)
      },

      navigationSubnav: (el) => {
        const subCategory = el.target.innerText

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'navigation_sub_category',
          action: `Clicked ${subCategory}`,
          eventData: {
            eventCategory: 'Navigation Header',
            eventAction: `Clicked ${subCategory}`
          }
        }
        Tracker.push(elyEvent)
      },

      navigationButton: (el) => {
        const button = Tracker.translateTarget(el)

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'navigation_header',
          action: `Clicked ${button}`,
          eventData: {
            eventCategory: 'Navigation Header',
            eventAction: `Clicked ${button}`
          }
        }
        Tracker.push(elyEvent)
      },

      clickUSP: (el) => {
        let usp = Tracker.translateTarget(el)

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'responsive_usp_bar',
          action: `click ${usp}`,
          click_url: '',
          component: 'Responsive USP bar',
          eventData: {
            eventCategory: 'Widget Track',
            eventAction: usp,
            eventLabel: 'Responsive USP bar',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      // Search
      search: () => {
        const searchInfo = window.Tracker.store.get('searchInfo')
        const pageData = Tracker.store.get('productList')
        const currency = Tracker.store.get('currency')
        const rayId = searchInfo?.rayId

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'search',
          search_term: searchInfo?.input,
          search_results: searchInfo?.resultsNumber,
          eventData: {
            eventCategory: 'Navigation Header',
            eventAction: `Clicked ${searchInfo?.input ?? ''}`,
            eventLabel: window?.location?.pathname + window?.location?.search,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)

        Tracker.sendPubSubEvent(
          'Search',
          {
            event: { type: 'search' },
            page: {
              search: {
                query: searchInfo?.input || '',
                total_results: searchInfo?.resultsNumber
              },
              items: Object.values(pageData?.items ?? {})?.map((product) => {
                return {
                  product_group: {
                    selected_variant: {
                      price: {
                        currency: currency,
                        value: parseFloat(product?.price)
                      },
                      sku: parseInt(product?.item_id)
                    },
                    total_variants: product?.total_variants
                  }
                }
              })
            }
          },
          rayId
        )
      },
      suggestedSearchQueries: (el) => {
        let query = Tracker.translateTarget(el)

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'search',
          actions: 'search suggestions',
          search_term: query,
          eventData: {
            eventCategory: 'Navigation Header',
            eventAction: `Clicked ${query}`,
            eventLabel: `/search/?q=${query}`,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      suggestedSearchProduct: (el) => {
        const sku = Tracker.translateTarget(el)
        const product = Tracker.store.get('suggestedProducts')[sku]

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'search',
          actions: 'product details',
          input: product,
          eventData: {
            eventCategory: 'Navigation Header',
            eventAction: `Clicked ${product?.product_id}:${product?.product_name}`,
            eventLabel: product?.url,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      // Basket
      goToBasket: (el) => {
        const key = Tracker.translateTarget(el)

        const quantity = Tracker.store.get(key)

        const elyEvent = {
          event: 'Link',

          eventData: {
            eventCategory: 'Link',
            eventAction: 'Go To Basket',
            eventLabel: quantity,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      viewBasket: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event: 'view_cart',
          eventData: {
            eventCategory: 'Navigation Header',
            eventAction: 'Clicked View Basket',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },
      updateCart: (e) => {
        const store = Tracker.translateTarget(e)
        const item = Tracker.store.get(store)
        Tracker.sendPubSubEvent('UpdateCart', {
          event: {
            type: 'cart_interaction_event',
            subtype: 'quantity_change',
            items: [
              {
                product_group: {
                  id: item?.item_master,
                  selected_variant: {
                    price: {
                      currency: Tracker.store.get('currency'),
                      value: parseFloat(item.price) * parseInt(item.quantity)
                    },
                    sku: parseInt(item.item_id)
                  }
                },
                quantity: parseInt(item.quantity)
              }
            ]
          }
        })
      },

      chatbotFeedback: (trackerParam, messageId) => {
        Tracker.sendPubSubEvent(
          'ChatbotConversationFeedback',
          {
            event: { type: 'conversation', subtype: `${trackerParam}` },
            ...(messageId && { origin: { widget_id: `${messageId}` } })
          },
          window.__xAltitudeHorizonRay__
        )
      },

      //Beauty assistant
      askQuestion: ({ prompt }) => {
        const { value } = Tracker.store.get('rayId')

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'ask_beauty_assistant_question',
          eventData: {
            eventLabel: 'Ask Beauty Assistant Question',
            eventCategory: 'Beauty Assistant',
            eventAction: 'Ask Question',
            eventLabelValue: prompt,
            path: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)

        Tracker.sendPubSubEvent(
          'AskBeautyAssistantQuestion',
          {
            event: { type: 'ask_beauty_assistant_question' },
            page: { search: { query: `${prompt}` } }
          },
          value
        )
      },
      getBeautyAssistantRecommendations: ({ recommendations }) => {
        const { value } = Tracker.store.get('rayId')

        const items = recommendations.reduce(
          (itemsAccumulator, currentRecommendedProduct) => {
            const variant =
              currentRecommendedProduct?.defaultVariant ||
              currentRecommendedProduct?.cheapestVariant

            if (!variant) {
              return itemsAccumulator
            }

            return [
              ...itemsAccumulator,
              {
                product_group: {
                  id: parseInt(variant?.sku),
                  selected_variant: {
                    price: {
                      currency: Tracker.store.get('currency'),
                      value: parseFloat(variant?.price?.price?.amount)
                    },
                    sku: parseInt(variant?.sku)
                  }
                }
              }
            ]
          },
          []
        )

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'get_beauty_assistant_recommendations',
          eventData: {
            eventLabel: 'Get Beauty Assistant Recommendations',
            eventCategory: 'Beauty Assistant',
            eventAction: 'Get Recommendations',
            eventLabelValue: '',
            path: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)

        Tracker.sendPubSubEvent(
          'GetBeautyAssistantRecommendations',
          {
            event: { type: 'get_beauty_assistant_recommendations' },
            page: { items }
          },
          value
        )
      },

      addToCart: (
        e,
        recommendationContext = null,
        recommendationSlotIndex = null,
        giftBoxedSkus = null
      ) => {
        const from_suggestions = !!document.getElementById('style-suggestions')
        let data =
          Tracker.store.get('buylistProducts')?.[e] ??
          Tracker.store.get('products')?.[e] ??
          Tracker.store.get('basket')?.[e]

        const eventType = !from_suggestions
          ? 'cart_interaction_event'
          : 'outfit_suggestions_cart_interaction_event'

        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventCategory: 'Product | AddToBasket',
            eventAction: 'success',
            eventLabel: data?.item_id,
            eventLabelValue: data?.item_name
          },
          eventPage: window?.location?.pathname
        }
        const basketItems = Tracker.getAllBasketItems(Tracker.store.get('basket'))
        const ecommerceEvent = {
          event: 'ecom_event',
          event_name: 'add_to_cart',
          ecommerce: {
            currencyCode: data?.currency ?? '',
            value: data?.value,
            basketItems: basketItems.map((item) => ({
              sku: item.product.sku,
              quantity: item.quantity,
              vipPrice: item.product.vipPrice,
              price: item.product.price,
              isFreeGift: item.freeGift
            })),
            items: [
              {
                item_id: data?.item_id ?? '',
                item_name: data?.item_name ?? '',
                item_brand: data?.item_brand ?? '',
                price: data?.value ?? 'unknown',
                index: data?.index,
                discount: data?.discount,
                affiliation: data?.affiliation,
                coupon: data?.coupon,
                item_category: data?.item_category,
                item_list_name: data?.item_list_name,
                item_variant: data?.variant,
                quantity: data?.quantity ?? 0
              }
            ]
          }
        }
        Tracker.push(ecommerceEvent, { commerce: true })
        Tracker.push(elyEvent)
        const items = [data]
        Tracker.sendPubSubEvent(
          'AddToCart',
          {
            event: {
              type: eventType,
              subtype: 'initial_add',
              items: items.map((item) => ({
                product_group: {
                  id: item?.item_master,
                  selected_variant: {
                    price: {
                      currency: Tracker.store.get('currency'),
                      value: parseFloat(item?.price) * parseInt(item?.quantity)
                    },
                    sku: parseInt(item?.item_id)
                  }
                },
                quantity: parseInt(item?.quantity)
              }))
            }
          },
          null,
          recommendationContext,
          recommendationSlotIndex,
          giftBoxedSkus
        )
      },

      addMultipleToCart: (
        skus,
        recommendationContext = null,
        recommendationSlotIndex = null
      ) => {
        if (!Array.isArray(skus) || skus.length === 0) {
          console.warn('addMultipleToCart requires a non-empty array of SKUs')
          return
        }

        const from_suggestions = !!document.getElementById('style-suggestions')
        const eventType = !from_suggestions
          ? 'cart_interaction_event'
          : 'outfit_suggestions_cart_interaction_event'

        const items = skus
          .map(
            (sku) =>
              Tracker.store.get('buylistProducts')?.[sku] ??
              Tracker.store.get('products')?.[sku] ??
              Tracker.store.get('basket')?.[sku]
          )
          .filter(Boolean)

        if (items.length === 0) {
          console.warn('No valid items found for SKUs:', skus)
          return
        }

        const totalValue = items.reduce(
          (sum, item) => sum + (parseFloat(item.value) || 0),
          0
        )

        const firstItem = items[0]
        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventCategory: 'Product | AddToBasket',
            eventAction: 'success',
            eventLabel: firstItem?.item_id,
            eventLabelValue: firstItem?.item_name
          },
          eventPage: window?.location?.pathname
        }
        const basketItems = Tracker.getAllBasketItems(Tracker.store.get('basket'))
        const ecommerceEvent = {
          event: 'ecom_event',
          event_name: 'add_to_cart',
          ecommerce: {
            currencyCode: firstItem?.currency ?? '',
            value: totalValue,
            basketItems: basketItems?.map((item) => ({
              sku: item.product.sku,
              quantity: item.quantity,
              vipPrice: item.product.vipPrice,
              price: item.product.price,
              isFreeGift: item.freeGift
            })),
            items: items.map((data) => ({
              item_id: data?.item_id ?? '',
              item_name: data?.item_name ?? '',
              item_brand: data?.item_brand ?? '',
              price: data?.value ?? 'unknown',
              index: data?.index,
              discount: data?.discount,
              affiliation: data?.affiliation,
              coupon: data?.coupon,
              item_category: data?.item_category,
              item_list_name: data?.item_list_name,
              item_variant: data?.variant,
              quantity: data?.quantity ?? 0
            }))
          }
        }

        Tracker.push(ecommerceEvent, { commerce: true })
        Tracker.push(elyEvent)

        Tracker.sendPubSubEvent(
          'AddToCart',
          {
            event: {
              type: eventType,
              subtype: 'initial_add',
              items: items.map((item) => ({
                product_group: {
                  id: item?.item_master,
                  selected_variant: {
                    price: {
                      currency: Tracker.store.get('currency'),
                      value: parseFloat(item?.price) * parseInt(item?.quantity)
                    },
                    sku: parseInt(item?.item_id)
                  }
                },
                quantity: parseInt(item?.quantity)
              }))
            }
          },
          null,
          recommendationContext,
          recommendationSlotIndex
        )
      },

      removeFromCart: (
        e,
        giftBoxedSkus = null
      ) => {
        let data = Tracker.store.get('basket')[e]
        const basketItems = Tracker.getAllBasketItems(Tracker.store.get('basket'))
        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventCategory: 'Product | Remove From Basket',
            eventAction: 'success',
            eventLabel: data?.item_id,
            eventLabelValue: data?.item_name
          },
          eventPage: window?.location?.pathname
        }
        const ecommerceEvent = {
          event: 'ecom_event',
          event_name: 'remove_from_cart',
          ecommerce: {
            currencyCode: data?.currency ?? '',
            value: data?.value,
            basketItems: basketItems?.map((item) => ({
              sku: item.product.sku,
              quantity: item.quantity,
              vipPrice: item.product.vipPrice,
              price: item.product.price,
              isFreeGift: item.freeGift
            })),
            items: [
              {
                item_id: data?.item_id ?? '',
                item_name: data?.item_name ?? '',
                item_brand: data?.item_brand ?? '',
                price: data?.value ?? 'unknown',
                index: data?.index,
                discount: data?.discount,
                affiliation: data?.affiliation,
                coupon: data?.coupon,
                item_category: data?.item_category,
                item_list_name: data?.item_list_name,
                item_variant: data?.variant,
                quantity: data?.quantity ?? 0
              }
            ]
          }
        }
        Tracker.push(ecommerceEvent, { commerce: true })
        Tracker.push(elyEvent)
        const items = [data]
        Tracker.sendPubSubEvent('RemoveFromCart', {
          event: {
            type: 'cart_interaction_event',
            subtype: 'trash',
            items: items.map((item) => ({
              product_group: {
                selected_variant: {
                  price: {
                    currency: Tracker.store.get('currency'),
                    value: parseFloat(item?.price) * parseInt(item?.quantity)
                  },
                  sku: parseInt(item?.item_id)
                }
              },
              quantity: parseInt(item?.quantity)
            }))
          }
        },
          null,
          null,
          null,
          giftBoxedSkus
        )
      },
      updateCart: (e) => {
        const store = Tracker.translateTarget(e)
        const item = Tracker.store.get(store)
        Tracker.sendPubSubEvent('UpdateCart', {
          event: {
            type: 'cart_interaction_event',
            subtype: 'quantity_change',
            items: [
              {
                product_group: {
                  selected_variant: {
                    price: {
                      currency: Tracker.store.get('currency'),
                      value: parseFloat(item.price) * parseInt(item.quantity)
                    },
                    sku: parseInt(item.item_id)
                  }
                },
                quantity: parseInt(item.quantity)
              }
            ]
          }
        })
      },
      goToCheckout: () => {
        const event = {
          event: 'elysiumEvent',
          event_name: 'go_to_checkout',
          eventData: { eventAction: 'Go To Checkout' }
        }

        Tracker.push(event)
      },
      goToBasket: () => {
        const event = {
          event: 'elysiumEvent',
          event_name: 'go_to_basket',
          quantity: Tracker.store.get('basketQuantity'),
          eventData: { eventAction: 'Go To Basket' }
        }
        Tracker.push(event)
      },

      basketProductClick: (e) => {
        let clickedItem = Tracker.translateTarget(e)
        const item = Tracker.store.get('basket')[clickedItem]

        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventCategory: 'Product | AddToBasket',
            eventAction: 'success',
            eventLabel: clickedItem,
            eventLabelValue: item?.item_name
          },
          eventPage: window?.location?.pathname
        }

        Tracker.push(elyEvent)
      },

      viewFreeGift: (e) => {
        const id = Tracker.translateTarget(e)
        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventCategory: 'freeProductSelection',
            eventAction: 'ViewedFreeGift',
            eventLabel: id
          },
          eventPage: window?.location?.pathname
        }

        Tracker.push(elyEvent)
      },

      selectFreeGift: (e) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'add_to_cart',
          currencyCode: window.siteObj.currency ?? '',
          ecommerce: { product_name: e },
          eventData: {
            eventCategory: 'freeProductSelection',
            eventAction: 'Add Item',
            eventLabel: e
          },
          eventPage: window?.location?.pathname
        }

        Tracker.push(elyEvent)
      },

      removeFreeGift: (e) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'remove_from_cart',
          currencyCode: window.siteObj.currency ?? '',
          ecommerce: { product_name: e },
          eventData: {
            eventCategory: 'freeProductSelection',
            eventAction: 'Removing Item',
            eventLabel: e
          },
          eventPage: window?.location?.pathname
        }
        Tracker.push(elyEvent)
      },

      applyCouponSuccess: (e) => {
        let coupon = Tracker.translateTarget(e)

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'apply_coupon_success',
          coupon_code: coupon,
          eventData: {
            eventCategory: 'Discount codes',
            eventAction: 'Valid',
            eventLabel: coupon,
            eventPage: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)
        Tracker.handlers.applyDiscountCode({ message: e.message })
      },

      applyCouponFailure: (e) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'apply_coupon_fail',
          coupon_code: e.promoCode,
          validation_errors: e.errorMessage,
          eventData: {
            eventCategory: 'Discount codes',
            eventAction: 'Inactive',
            eventLabel: e.promoCode,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
        Tracker.handlers.applyDiscountCode({ message: e.errorMessage })
      },
      applyDiscountCode: (e) => {
        Tracker.sendPubSubEvent('ApplyDiscountCodeToBasket', {
          event: { type: 'discount_code_event' }
        })
      },
      // Wish list
      wishlistLoggedout: (el) => {
        const item =
          Tracker?.store?.get('productList')?.items?.[el] ||
          Tracker?.store?.get('products')?.[el] ||
          Tracker?.store?.get('basket')?.[el]
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'wishlist_logged_out',
          product_id: el,
          product_name: item?.item_name,
          eventData: {
            eventCategory: 'Wishlist Engagement',
            eventAction: 'Clicked add to wishlist | Logged out',
            eventLabel: el,
            eventPage: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)
      },

      // wishlistLogin: (el) => {
      //   const sku = el?.target.dataset.trackPush
      //   console.log(sku)
      //   let item
      //   if(Tracker.store.get('productList')){
      //     item = Tracker.store.productList.items[sku]
      //   } else if (Tracker.store.get('products')){
      //     item =  Tracker.store.products[sku]
      //   }
      //   const elyEvent = {
      //     event: 'elysiumEvent',
      //     event_name: 'wishlist_login',
      //     product_id: sku,
      //     product_name: item.item_name,
      //     eventData: {
      //       eventCategory: 'Wishlist Engagement',
      //       eventAction: 'clicked login link',
      //       eventLabel: sku,
      //       eventPage: window?.location?.pathname
      //     }
      //   }
      //   Tracker.push(elyEvent)
      // },

      // wishlistRegister: (el) => {
      //   let item
      //   if(Tracker.store.get('productList')){
      //     item = Tracker.store.productList.items[el]
      //   } else if (Tracker.store.get('products')){
      //     item =  Tracker.store.products[el]
      //   }

      //   const elyEvent = {
      //     event: 'elysiumEvent',
      //     event_name: 'wishlist_login',
      //     product_id: id,
      //     product_name: item.item_name,
      //     eventData: {
      //       eventCategory: 'Wishlist Engagement',
      //       eventAction: 'clicked register link',
      //       eventLabel: id,
      //       eventLabeValue: item?.item_name,
      //       eventPage: window?.location?.pathname
      //     }
      //   }
      //   Tracker.push(elyEvent)
      // },

      wishlistAdded: (el) => {
        const item =
          Tracker?.store?.get('productList')?.items?.[el] ||
          Tracker?.store?.get('products')?.[el] ||
          Tracker?.store?.get('basket')?.[el]

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'add_to_wishlist',
          product_id: item?.item_id,
          product_name: item?.item_name,
          eventData: {
            eventCategory: 'Wishlist Engagement',
            eventAction: 'added to wishlist',
            eventLabel: item?.item_id,
            eventPage: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)

        const gaEvent = {
          event: 'ecom_event',
          event_name: 'add_to_wishlist',
          ecommerce: {
            currency: item?.currency,
            page_type: window?.location?.pathname,
            item_list_name: item?.item_list_name,
            items: [
              {
                item_id: item?.item_id,
                item_name: item?.item_name,
                item_brand: item?.brand,
                price: item?.price,
                discount: item?.discount,
                affiliation: item?.affiliation,
                coupon: item?.coupon,
                item_category: item?.item_category,
                item_list_name: item?.item_list_name,
                item_variant: item?.variant,
                quantity: 1
              }
            ]
          }
        }
        Tracker.push(gaEvent)
      },

      wishlistRemove: (el) => {
        const item =
          Tracker?.store?.get('productList')?.items?.[el] ||
          Tracker?.store?.get('products')?.[el] ||
          Tracker?.store?.get('basket')?.[el]

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'wishlist_removed',
          product_id: item?.item_id,
          product_name: item?.item_name,
          eventData: {
            eventCategory: 'Wishlist Engagement',
            eventAction: 'removed from wishlist',
            eventLabel: item?.item_id,
            eventPage: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)
        Tracker.sendPubSubEvent('RemoveFromWishlist', {
          event: {
            type: 'wishlist_interaction_event',
            subtype: 'trash',
            items: [{ product_group: { id: parseInt(el) }, quantity: 1 }]
          }
        })
      },

      // PLP
      plp: () => {
        const pageData = Tracker.store.get('productList')

        Tracker.sendPubSubEvent(
          'ProductList',
          {
            event: { type: 'product_list_visit' },
            page: {
              items: Object.values(pageData?.items ?? {})?.map((product) => {
                return {
                  product_group: {
                    selected_variant: {
                      price: {
                        currency:
                          pageData.currency || Tracker.store.get('currency'),
                        value: parseFloat(product?.price)
                      },
                      sku: parseInt(product?.item_id)
                    },
                    total_variants: product?.total_variants
                  }
                }
              })
            }
          },
          window.__xAltitudeHorizonRay__
        )
      },

      home: (e) => {
        const store = Tracker.translateTarget(e)
        const pageData = Tracker.store.get(store)
        Tracker.sendPubSubEvent(
          'Homepage',
          { event: { type: 'homepage' } },
          pageData.rayId
        )
      },

      viewItemList: () => {
        const list = window.Tracker.store.get('productList')

        const gaEvent = {
          event: 'view_item_list',
          currencyCode: list?.currency,
          ecommerce: {
            item_list_id: list?.id ?? '',
            item_list_name: list?.title ?? '',
            items: list.items && Object.values(list.items)
          },
          platformType: 'Altitude'
        }
        Tracker.push(gaEvent)
      },

      ReadMoreClicked: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'read_more_click',
          eventData: {
            eventCategory: 'Read More Button',
            eventAction: `Clicked`,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      selectItem: (el) => {
        const item = Tracker.translateTarget(el)
        const product = Tracker.store.get('productList').items
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'navigation_list',
          action: 'Click product image',
          product_id: product[item]?.item_id,
          product_name: product[item]?.item_name,
          eventData: {
            eventCategory: 'List Page Navigation',
            eventAction: ` ${product[item]?.url}| Click product image`,
            eventLabel: product[item]?.item_id,
            eventPage: window?.location?.pathname
          }
        }

        const gaEvent = {
          event: 'select_item',
          ecommerce: {
            item_list_id: product[item]?.item_list ?? '',
            item_list_name: product[item]?.title ?? '',
            items: [
              {
                item_id: product[item]?.item_id,
                item_list: product[item]?.item_list,
                item_brand: product[item]?.brand,
                price: product[item]?.price,
                value: product[item]?.value,
                discount: product[item]?.discount,
                coupon: product[item]?.coupon,
                affiliation: product[item]?.affiliation,
                index: product[item]?.index,
                item_list_id: product[item]?.item_id,
                item_list_name: product[item]?.item_list,
                item_variant: product[item]?.variant,
                quantity: 1
              }
            ]
          }
        }
        Tracker.push(elyEvent)
        Tracker.push(gaEvent)
      },

      showFilter: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'filter',
          category: 'product category',
          action: 'opens',
          type: 'amino acids',
          eventData: {
            eventCategory: 'responsiveFacets',
            eventAction: 'Opens',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      closeFilter: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'filter',
          category: 'product category',
          action: 'closes',
          type: 'amino acids',
          eventData: {
            eventCategory: 'responsiveFacets',
            eventAction: 'Closes',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      filterOpen: () => {
        const event = {
          event: 'elysiumEvent',
          event_name: 'filter_open',
          category: '',
          eventData: {
            eventCategory: 'responsiveFacets',
            eventAction: 'Opens',
            type: 'amino acids',
            eventPage: window?.location?.pathname
          }
        }

        Tracker.push(event)
      },

      filter: (e) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'filter_applied',
          filter: e,
          eventData: {
            eventCategory: 'responsiveFacets',
            eventAction: 'add',
            eventLabel: e,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      filterRemoved: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'filter_removed',
          category: el.eventCategory,
          eventData: {
            eventCategory: 'responsiveFacets',
            eventAction: 'Removes',
            eventLabel: el.eventCategory,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      filterClear: (e) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'filter_cleared',
          eventData: {
            eventCategory: 'responsiveFacets',
            eventAction: 'remove',
            eventLabel: 'all facets',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      sortByOpen: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'sort_by_open',
          eventData: {
            eventCategory: 'Facet Engagement',
            eventAction: 'Opens Sort By',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      sortByClose: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'sort_by_closed',
          eventData: {
            eventCategory: 'Facet Engagement',
            eventAction: 'Closes Sort By',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      sortByClick: (el) => {
        const sortType = Tracker.translateTarget(el)

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'sort_by_clicked',
          type: sortType,
          eventData: {
            eventCategory: 'Facet Engagement',
            eventAction: 'Selects Sort By',
            eventLabel: sortType,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      viewPromotion: (e) => {
        let promo = Tracker.translateTarget(e)

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'pap_banner_viewed',
          component: 'promo',
          ecommerce: {
            items: [
              {
                promotion_id: '',
                promotion_name: promo,
                creative_name: '',
                creative_slot: '',
                location_id: ''
              }
            ]
          },
          eventData: {
            eventCategory: 'Pap | papBanner',
            eventAction: 'Viewed',
            eventLabel: 'papBanner component',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      promoClick: (el) => {
        const promo = Tracker.translateTarget(el)
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'pap_banner_description_clicked',
          component: 'promo',
          promotion_id: '',
          promotion_name: promo,
          creative_name: '',
          creative_slot: '',
          location_id: '',
          eventData: {
            eventCategory: 'Pap | papBanner',
            eventAction: 'Clicked',
            eventLabel: 'papBanner component',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      promoButtonClick: (e) => {
        const promo = Tracker.translateTarget(e)

        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventCategory: 'Pap | papDescriptionCTA',
            eventAction: 'Clicked',
            eventLabel: 'papDescription component',
            eventPage: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)
      },

      // PDP/Quickbuy modal
      viewItem: (e) => {
        let itemSku = Tracker.translateTarget(e)
        let data = Tracker.store.get('products')?.[itemSku]

        //checks if the product is not a variant (master sku product)
        //checks if the products deafult product is not pre selected (eg. size, colour)
        if (!data?.variant && data?.defaultVariantSku !== data?.item_id) {
          data = Tracker.store.get('products')[data?.defaultVariantSku]
          itemSku = data?.defaultVariantSku
        }

        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventCategory: 'Product | Viewed',
            eventAction: 'Viewed',
            eventLabel: itemSku,
            eventLabelValue: [Tracker.store.get(itemSku)],
            eventPage: window?.location?.pathname
          }
        }
        const gaEvent = {
          event: 'ecom_event',
          event_name: 'view_item',
          ecommerce: {
            currencyCode: Tracker.store.get('currency') ?? '',
            value: data?.value,
            items: [
              {
                item_id: data?.item_id ?? '',
                item_name: data?.item_name ?? '',
                item_brand: data?.item_brand ?? '',
                price: data?.value ?? 'unknown',
                index: data?.index,
                discount: data?.discount,
                affiliation: data?.affiliation,
                coupon: data?.coupon,
                item_category: data?.category,
                item_list_name: data?.item_list_name,
                item_variant: data?.variant,
                quantity: data?.quantity ?? 0
              }
            ]
          }
        }
        Tracker.push(gaEvent)
        Tracker.push(elyEvent)
      },

      productDesView: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'product_description_viewed',
          component: 'productDescriptionComponent',
          eventData: {
            eventCategory: 'Product | Description',
            eventAction: 'Viewed',
            eventLabel: 'productDescription component',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      productImageScrolled: (el) => {
        const imgInx = Tracker.translateTarget(el)
        const indexInfo = window.Tracker.store.get('imageIndex')

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'product_image_scroll',
          index: indexInfo?.index,
          eventData: {
            eventCategory: 'ProductImageCarousel',
            eventAction: 'scroll',
            eventLabel: `Scrolled to image ${indexInfo?.index} `,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      productThumbnailClicked: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'product_image_click',
          carousel_nav: 'thumbnail',
          product_id: el?.id,
          product_name: el?.title,
          image_number: el?.index,
          eventData: {
            eventCategory: 'athenaProductImageCarousel',
            eventAction: 'click',
            eventLabel: `thumbnail`,
            eventLabelValue: el?.index,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      productDesClick: (el) => {
        const eventCategory = el.target.dataset.trackingPush

        const elyEvent = {
          event: 'elysiumEvent',
          event: 'product_desciption_clicked',
          component: 'productDescriptionComponent',
          type: eventCategory,
          eventData: {
            eventCategory: 'Product | Description',
            eventAction: 'Clicked',
            eventLabel: `productDescription component clicked tab ${eventCategory}`,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      reviewViewed: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'review_viewed',
          component: 'ProductReviews component',
          eventData: {
            eventCategory: 'Product | Review',
            eventAction: 'Viewed',
            eventLabel: 'athenaProductReviews component',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      reviewVoted: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'review_voted',
          component: 'ProductReviews component',
          voted: el.voted,
          id: el.id,
          eventData: {
            eventCategory: 'Product | Voted',
            eventAction: 'Voted',
            eventLabel: `athenaProductReviews component voted ${el.voted} ${el.id}`,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      reviewReported: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'product_reported',
          eventData: {
            eventCategory: 'Product | Reported',
            eventAction: 'Reported',
            eventLabel: `athenaProductReviews component reported ${el.id}`,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      reviewCreated: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'review_create',
          product_id: el.product_id,
          product_name: el.product_name,
          rating: el?.rating,
          eventData: {
            eventCategory: 'Product | Reported',
            eventAction: 'Reported',
            eventLabel: `athenaProductReviews component reported ${el?.product_id}`,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      reviewPage: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'review_pagination',
          eventData: {
            eventCategory: 'Product | Review',
            eventAction:
              el === 'next' ? 'Next Review Page' : 'Previous Review Page',
            eventLabel: `athenaProductReviews component go ${el} page`,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      // PDP
      productImageNav: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'product_image_nav',
          action: `${el?.eventAction} image`,
          producnt_id: el?.id,
          product_name: el?.title,
          eventData: {
            eventCategory: 'ProductImageCarousel',
            eventAction: 'click',
            eventLabel: `${el?.eventAction} image`,
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      sizeGuideClick: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'product_size_guide',
          action: 'Clicked',
          component: 'productSizeGuide component clicked button',
          eventData: {
            eventCategory: 'Product | Size Guide',
            eventAction: 'Clicked',
            eventLabel: 'productSizeGuide',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      sizeGuideModalOpen: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'product_size_guide',
          action: 'Clicked',
          component: 'productSizeGuide component clicked button',
          path: window?.location?.pathname,
          eventData: {
            eventCategory: 'Product | Size Guide modal',
            eventAction: 'Shown',
            eventLabel: 'productSizeGuide',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },

      sizeGuideModalClose: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'product_size_guide_closed',
          component: 'product size guide modal',
          path: window?.location?.pathname,
          eventData: {
            eventCategory: 'Product | Size Guide modal',
            eventAction: 'Closed',
            eventLabel: 'product Size Guide',
            eventPage: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)
      },
      updateMarketingPreferences: () => {
        Tracker.sendPubSubEvent('MarketingPreferenceUpdated', {
          event: {
            type: 'account_update',
            subtype: 'communication_preferences'
          }
        })
      },
      pageVisit: () => {
        Tracker.sendPubSubEvent(
          'PageVisit',
          { event: { type: 'page_visit' } },
          window.__xAltitudeHorizonRay__
        )
      },
      productVisit: (e) => {
        const store = Tracker.translateTarget(e)
        const pageData = Tracker.store.get(store)
        const productData = Tracker.store.get('products')[pageData.sku]
        Tracker.sendPubSubEvent(
          'ProductVisit',
          {
            event: { type: 'product_visit' },
            page: {
              items: [
                {
                  product_group: {
                    id: parseInt(productData?.item_id),
                    selected_variant: {
                      price: {
                        currency: Tracker.store.get('currency'),
                        value: parseFloat(productData?.price)
                      },
                      sku: parseInt(productData?.item_id)
                    }
                  }
                }
              ]
            }
          },
          pageData.rayId
        )
      },
      provenanceTrustBadgeClick: (e) => {
        const sku = e?.target?.dataset.sku
        const label = Tracker?.store['products'][sku]?.item_name

        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventAction: 'Verified Product',
            eventCategory: 'Provenance',
            eventLabel: label
          },
          eventPage: window?.location?.pathname
        }

        Tracker.push(elyEvent)
      },
      // ---> MTA handlers <---
      loginSuccess: () => {
        const elyEvent = {
          event: 'CustomEvent Account Creation',
          eventData: {
            eventCategory: 'login',
            eventAction: 'login success',
            eventLabel: 'Form'
          }
        }

        Tracker.push(elyEvent)
      },

      loginFailed: () => {
        const elyEvent = {
          event: 'custom_event',
          event_name: 'login_failed',
          method: Tracker.store.get('login_method')?.value,
          error_value: Tracker.store.get('login_error_value')?.value
        }
        Tracker.push(elyEvent)
      },

      logout: () => {
        const elyEvent = { event: 'custom_event', event_name: 'logout' }
        Tracker.push(elyEvent)
      },

      accountRegistrationSuccess: () => {
        const elyEvent = {
          event: 'custom_event',
          event_name: 'sign_up',
          method: Tracker.store.get('account_registration_method')?.value,
          user_id: Tracker.store.get('user_id')?.value
        }
        Tracker.push(elyEvent)
        Tracker.sendPubSubEvent('Login', {
          event: { type: 'login', subtype: 'account_creation' }
        })
      },

      accountRegistrationFail: () => {
        const elyEvent = {
          event: 'CustomEvent Account Creation',
          eventData: {
            eventCategory: 'login',
            eventAction: 'account created Failed',
            eventLabel: 'Form'
          }
        }

        Tracker.push(elyEvent)
      },
      checkoutStart: async (e) => {
        const items = Tracker.store.get('products') || []
        const currency = Tracker.store.get('currency')

        const gaEvent = {
          event_name: 'begin_checkout',
          currencyCode: currency,
          Items: Object.values(items)
        }

        Tracker.push(gaEvent)
        // const store = Tracker.translateTarget(e);
        // const data = Tracker.store.get(store);
        // return Tracker.sendPubSubEvent(
        //   "StartCheckout",
        //   {
        //     event: {
        //       type: "checkout_start",
        //       subtype: "standard_checkout",
        //     },
        //   },
        //   data.rayId
        // );
      },
      guestCheckoutStart: async (e) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'continue_as_guest',
          category: 'Continue as guest',
          action: 'Clicked'
        }
        Tracker.push(elyEvent)

        const store = Tracker.translateTarget(e)
        const data = Tracker.store.get(store)
        return Tracker.sendPubSubEvent(
          'StartGuestCheckout',
          { event: { type: 'checkout_start', subtype: 'guest_checkout' } },
          data.rayId
        )
      },
      // ---> MTA handlers <---
      pageNotFound: () => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'page_not_found',
          eventData: {
            eventCategory: 'Errors',
            eventAction: 'Page Not Found',
            path: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)
      },
      emptyList: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'empty_page',
          eventData: {
            eventLabel: 'Empty List',
            eventLabelValue: el,
            path: window?.location?.pathname
          }
        }

        Tracker.push(elyEvent)
      },
      noSearchResult: (el) => {
        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'no_search_results',
          eventData: {
            eventLabel: 'No Search Results',
            eventLabelValue: el,
            path: window?.location?.pathname + window?.location?.search
          }
        }

        Tracker.push(elyEvent)
      },
      startPageSize: (el) => {
        const key = Tracker.translateTarget(el)
        const size = Tracker.store.get(key)

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'start_page_size',
          height: size.height,
          width: size.width,
          eventData: {
            eventLabel: 'Start Page Size',
            eventLabelValue: { height: size.height, width: size.width },
            path: window?.location?.pathname + window?.location?.search
          }
        }

        Tracker.push(elyEvent)
      },
      outOfStock: (el) => {
        const item = window.Tracker.store.get(el)

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'sold_out_product',
          eventData: {
            eventLabel: 'Sold Out Product',
            eventLabelValue: item,
            path: window?.location?.pathname + window?.location?.search
          }
        }
        Tracker.push(elyEvent)
      },
      showOutfitSuggestions: ({ success = false, sku }) => {
        const product = Tracker.store.get('products')[sku]
        const { rayId } = Tracker.store.get('productVisit')

        const items = success
          ? [
            {
              product_group: {
                id: parseInt(product?.item_id),
                selected_variant: {
                  price: {
                    currency: Tracker.store.get('currency'),
                    value: parseFloat(product?.price)
                  },
                  sku: parseInt(product?.item_id)
                }
              }
            }
          ]
          : []

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'show_outfit_suggestions',
          eventData: {
            eventLabel: 'Show Outfit Suggestions',
            eventSuccess: success,
            eventCategory: 'Outfit Suggestions',
            eventAction: 'Show',
            eventLabelValue: sku,
            path: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)

        Tracker.sendPubSubEvent(
          'ShowOutfitSuggestions',
          { event: { type: 'show_outfit_suggestions' }, page: { items } },
          rayId
        )
      },
      outfitSuggestionsVisit: ({ sku }) => {
        const product = Tracker.store.get('products')[sku]
        const { value } = Tracker.store.get('rayId')

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'visit_outfit_suggestions_item',
          eventData: {
            eventLabel: 'Visit Outfit Suggestions Item',
            eventCategory: 'Outfit Suggestions',
            eventAction: 'Visit Product',
            eventLabelValue: sku,
            path: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)

        Tracker.sendPubSubEvent(
          'VisitOutfitSuggestionsItem',
          {
            event: { type: 'visit_outfit_suggestions_item' },
            page: {
              items: [
                {
                  product_group: {
                    id: parseInt(product?.item_id),
                    selected_variant: {
                      price: {
                        currency: Tracker.store.get('currency'),
                        value: parseFloat(product?.price)
                      },
                      sku: parseInt(product?.item_id)
                    }
                  }
                }
              ]
            }
          },
          value
        )
      },
      suggestedProductReview: ({ sku, approved = false }) => {
        const { value } = Tracker.store.get('rayId')
        const eventType = approved
          ? 'approved_suggested_item'
          : 'rejected_suggested_item'

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: eventType,
          eventData: {
            eventLabel: 'Review Suggestions Item',
            eventCategory: 'Outfit Suggestions',
            eventAction: 'Review Product',
            eventLabelValue: sku,
            path: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)

        Tracker.sendPubSubEvent(
          'ReviewSuggestionsItem',
          {
            event: { type: eventType },
            items: [{ product_group: { id: parseInt(sku) } }]
          },
          value
        )
      },
      showSuggestedItemJustification: ({ sku }) => {
        const { value } = Tracker.store.get('rayId')

        const elyEvent = {
          event: 'elysiumEvent',
          event_name: 'show_suggested_item_justification',
          eventData: {
            eventLabel: 'Show Suggested Item Justification',
            eventCategory: 'Outfit Suggestions',
            eventAction: 'Review Product',
            eventLabelValue: sku,
            path: window?.location?.pathname
          }
        }
        Tracker.push(elyEvent)

        Tracker.sendPubSubEvent(
          'ShowSuggestedItemJustification',
          {
            event: { type: 'show_suggested_item_justification' },
            items: [{ product_group: { id: parseInt(sku) } }]
          },
          value
        )
      },

      foundationFinderShadeMatch: (sku, source_id) => {
        Tracker.sendPubSubEvent('FFFindMyShadeMatch', {
          event: {
            type: 'ff_find_my_shade_match',
            items: [
              {
                product_group: {
                  id: parseInt(sku),
                  promotion: { name: source_id }
                }
              }
            ]
          }
        })
      },
      foundationFinderToolOpen: (sku) => {
        Tracker.sendPubSubEvent('FFFindMyShadeOpen', {
          event: {
            type: 'ff_find_my_shade_open',
            items: [{ product_group: { id: parseInt(sku) } }]
          }
        })
      },
      showQuickBuyModal: (recommendationContext, recommendationSlotIndex) => {
        Tracker.sendPubSubEvent(
          'ShowQuickBuyModal',
          {
            event: {
              type: 'page_visit',
              subtype: 'quickbuy_modal_shown'
            }
          },
          null,
          recommendationContext,
          recommendationSlotIndex
        )
      },
      showSideSheet: (subtype = '', recommendationContext, recommendationSlotIndex) => {
        Tracker.sendPubSubEvent(
          'ShowSideSheet',
          {
            event: {
              subtype,
              type: 'page_visit'
            }
          },
          null,
          recommendationContext,
          recommendationSlotIndex
        )
      },
      clickShade: () => {
        Tracker.sendPubSubEvent('color_swatch_click', {
          event: {
            type: 'click',
            subtype: 'shade_selector'
          }
        })
      },
      foundationFinderShadeAddToBasket: (sku, source_id, type) => {
        Tracker.sendPubSubEvent('FFFindMyShadeAdd', {
          event: {
            type: 'ff_find_my_shade_add',
            items: [
              {
                product_group: {
                  id: parseInt(sku),
                  promotion: { name: source_id, type: type }
                }
              }
            ]
          }
        })
      },
      // TODO - should refactor once tracking strategy is confirmed. New basket flow
      // is no longer built around passing a single gift box sku to the modal.
      // The sidesheet opens with all skus
      showGiftBoxSideSheet: (giftBoxSku) => {
        const giftBox = __AVAILABLE_GIFT_BOXES__?.[giftBoxSku]
        const eligibleProducts = giftBox?.eligibleProducts || []

        let ecommItems = []
        let pubSubItems = []

        eligibleProducts.forEach(item => {
          ecommItems.push({
            discount: item.discount,
            item_brand: item.brand,
            item_id: parseInt(item.sku, 10),
            item_name: item.title,
            item_variant: item.variant,
            price: item.price,
          })
          pubSubItems.push({
            product_group: {
              id: parseInt(item.sku, 10),
              selected_variant: {
                price: {
                  currency: Tracker.store.get('currency'),
                  value: parseFloat(item.price)
                },
                sku: parseInt(item.sku, 10)
              }
            }
          })
        })

        const elyEvent = {
          event: 'elysiumEvent',
          eventData: {
            eventCategory: 'Gift Box | Viewed',
            eventAction: 'Viewed',
            eventLabel: giftBoxSku,
            eventLabelValue: [Tracker.store.get(giftBoxSku)],
            eventPage: window?.location?.pathname
          }
        }
        const gaEvent = {
          event: 'ecom_event',
          event_name: 'view_gift_box',
          ecommerce: {
            currencyCode: Tracker.store.get('currency') ?? '',
            items: ecommItems,
            value: giftBox?.amount
          }
        }
        const pubSubEvent = {
          event: {
            items: pubSubItems,
            subtype: 'giftbox_modal_shown',
            type: 'page_visit'
          }
        }

        Tracker.push(elyEvent)
        Tracker.push(gaEvent)
        Tracker.sendPubSubEvent(
          'ShowGiftBoxModal',
          pubSubEvent
        )
      }
    },
    trackApiConfig: null,
    config: null,
    store: {
      get(k) {
        return Tracker.store[k]
      },
      set(k, v) {
        return (Tracker.store[k] = Tracker.store[k]
          ? Object.assign(Tracker.store[k], v)
          : v)
      }
    },
    getAllBasketItems: (basketData) => {
      return [
        ...(basketData?.items || []),
        ...(basketData?.giftWrapItems || [])
      ]
    }
  }
  Tracker.assignTracker()
  if (typeof window.Tracker.load !== 'function') {
    Tracker.init({
      debug: true,
      selectors: {
        track: 'data-track',
        type: 'data-track-type',
        store: 'data-track-push',
        currency: 'data-track-currency'
      }
    })
  } else {
    window.Tracker.load()
  }
})()
