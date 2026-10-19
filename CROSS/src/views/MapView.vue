<template>
  <div class="map-view">
    <div class="workspace" :class="[{ 'left-collapsed': leftCollapsed, 'right-collapsed': rightCollapsed, 'mobile-agent-open': mobileAgentOpen, 'point-form-open': pointFormOpen }, `mobile-sheet-${mobileSheet}`]">
      <aside ref="leftPanelRef" class="legacy-sidebar">
        <button
          class="mobile-sheet-handle"
          type="button"
          :aria-label="mobileSheetLabel"
          @pointerdown="startSheetDrag"
          @pointermove="moveSheetDrag"
          @pointerup="finishSheetDrag"
          @pointercancel="cancelSheetDrag"
          @keydown.enter.prevent="cycleMobileSheet"
          @keydown.space.prevent="cycleMobileSheet"
        ><span></span></button>
        <button class="mobile-companion-launcher" type="button" :aria-label="mobileCompanionCopy" @click="openMobileAgent">
          <CrossCompanion :status="agentVisualState" />
          <span>{{ mobileCompanionCopy }}</span>
        </button>
        <div class="legacy-sidebar-content">
          <div class="mobile-sheet-summary">
            <strong>路线规划</strong>
            <span>{{ mobileSheet === 'expanded' ? '收起' : mobileSheet === 'half' ? '展开' : '上拉查看地点' }}</span>
          </div>
          <div class="legacy-header">
            <div class="legacy-header-row">
              <strong>路线规划</strong>
              <button class="legacy-sample" @click="loadPresetRoute">加载示例</button>
              <button class="clear-route-action" @click="clearRoute" :disabled="destinations.length === 0">清空路线</button>
            </div>
          </div>
          <div v-if="destinations.length" class="route-ticket">
            <strong>{{ currentRoute?.name || '我的旅行路线' }}</strong>
            <small v-if="routeEndpoints" class="route-endpoints">{{ routeEndpoints }}</small>
            <span>{{ routeDayCount }} 天</span>
            <span>{{ destinations.length }} 个地点</span>
            <span>步行 {{ routeDistanceSummary }}</span>
            <button class="reservation-summary" type="button" :disabled="!reservationDueCount" :aria-expanded="reservationListOpen" @click="reservationListOpen = !reservationListOpen">待预约 {{ reservationDueCount }} 个</button>
            <div v-if="reservationListOpen && reservationDueCount" class="reservation-list">
              <button v-for="place in reservationsDue" :key="place.id" type="button" @click="openReservationPlace(place)">{{ place.name }} <span>查看 ↗</span></button>
            </div>
          </div>
          <div class="legacy-actions">
            <button class="new-route-action" @click="requestNewRoute">新建路线</button>
            <button class="save-route-action" @click="saveRoute" :disabled="destinations.length === 0">保存路线<svg v-if="saveFeedback" class="save-check" viewBox="0 0 24 20" aria-label="已保存"><path d="M2 10.5 8.5 17 22 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          </div>
          <div v-if="dayOptions.length || unscheduledDestinations.length" class="legacy-days">
            <button class="overview-tab" :class="{ active: activeDay === 'overview' }" @click="selectDay('overview')">总览</button>
            <button
              v-for="day in dayOptions"
              :key="day"
              :class="{ active: activeDay === day }"
              :style="{ '--day-color': dayColor(day) }"
              @click="selectDay(day)"
            >Day {{ day }}</button>
            <button class="day-count-action" type="button" aria-label="增加一天" title="增加一天" :disabled="routeDayCount >= 14" @click="addDay"><span>＋</span></button>
            <button class="day-count-action" type="button" aria-label="删除最后一个空白 Day" title="只能删除空白的最后一天" :disabled="routeDayCount <= 1 || lastDayHasPlaces" @click="removeLastDay"><span>－</span></button>
            <button class="unscheduled-tab" :class="{ active: activeDay === 'unscheduled' }" @click="selectDay('unscheduled')">待规划</button>
          </div>
          <p v-if="typeof activeDay === 'number'" class="day-summary">第 {{ activeDay }} 天 · {{ visibleDestinations.length }} 个地点 · 步行 {{ walkingDistanceForDay(activeDay) }}</p>
          <div v-if="AGENT_CHAT_AVAILABLE && agentSession.draftPlan" class="route-source-tabs">
            <button :class="{ active: !previewingDraft }" @click="showFormalRoute">正式行程</button>
            <button :class="{ active: previewingDraft }" @click="focusDraftPreview">草案预览</button>
          </div>
          <div class="legacy-list">
            <div v-if="activeDay === 'unscheduled' && !previewingDraft" class="pending-heading">
              <strong>待规划 <span>{{ unscheduledDestinations.length }}</span></strong>
              <small>这些地点还没放进某一天</small>
            </div>
            <div v-if="visibleDestinations.length === 0" class="legacy-empty">
              <div v-if="!destinations.length && !previewingDraft" class="empty-journey" aria-hidden="true">
                <svg viewBox="0 0 150 48"><path d="M5 38 C30 37 38 8 67 17 S102 43 131 21" /><circle cx="5" cy="38" r="3" /></svg>
                <img src="/assets/mascot_full_transparent.svg" alt="">
              </div>
              <span>{{ previewingDraft ? '草案中暂无可展示地点' : typeof activeDay === 'number' ? '这一天还没有地点，去地图上选一个吧' : activeDay === 'unscheduled' ? '待规划还是空的，先找一个想去的地方' : '还没有路线，先找一个想去的地方' }}</span>
              <button v-if="!previewingDraft" type="button" @click="focusPoiSearch">查找地点 ↗</button>
            </div>
            <template v-for="(place, index) in visibleDestinations" :key="place.id">
              <div v-if="transportSegmentBefore(index)" class="transport-segment-row" @click.stop>
                <button
                  class="transport-segment-summary"
                  type="button"
                  :aria-expanded="expandedTransportSegmentId === transportSegmentBefore(index)?.id"
                  @click="toggleTransportSegment(transportSegmentBefore(index)!.id)"
                >
                  <span v-if="transportSegmentBefore(index)?.status === 'loading'">正在查询路线…</span>
                  <span v-else-if="transportSegmentBefore(index)?.status === 'failed'">未获取到路线</span>
                  <span v-else class="transport-description">
                    <span v-if="transportSegmentBefore(index)?.mode === 'walk'" class="walking-steps" aria-hidden="true">
                      <svg v-for="step in footprintCount(transportSegmentBefore(index)!)" :key="step" viewBox="0 0 14 20"><path d="M6 2c2-1 4 1 4 4l1 4c1 3-1 6-4 7-3 0-5-2-5-5l1-5c0-2 1-4 3-5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                    </span>
                    {{ transportSummary(transportSegmentBefore(index)!) }}
                  </span>
                  <span class="transport-expand-mark">{{ expandedTransportSegmentId === transportSegmentBefore(index)?.id ? '收起' : '方式 ⌄' }}</span>
                </button>
                <button
                  v-if="transportSegmentBefore(index)?.status === 'failed'"
                  class="transport-retry"
                  type="button"
                  @click="tripStore.retryTransportSegment(transportSegmentBefore(index)!.id)"
                >重试</button>
                <div v-if="expandedTransportSegmentId === transportSegmentBefore(index)?.id" class="transport-mode-options">
                    <button
                    v-for="mode in transportModes"
                    :key="mode.value"
                    type="button"
                      :title="mode.value === 'drive' ? '按驾车路线估算，不含叫车时间和费用' : mode.label"
                    :class="{ active: transportSegmentBefore(index)?.mode === mode.value }"
                    :aria-pressed="transportSegmentBefore(index)?.mode === mode.value"
                    @click="tripStore.setTransportMode(transportSegmentBefore(index)!.id, mode.value)"
                  >
                    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <template v-if="mode.value === 'walk'"><path d="M14 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM12 10l-3 5 4 2 2-5 4 2M13 17l-3 6m5-9 4 8" /></template>
                      <template v-else-if="mode.value === 'cycle'"><circle cx="7" cy="20" r="4"/><circle cx="22" cy="20" r="4"/><path d="m7 20 5-10 5 10H7m5-10h5m0 0 5 10m-5-10-2-3" /></template>
                      <template v-else-if="mode.value === 'drive'"><path d="m5 17 2-7c.3-1 1-2 2-2h10c1 0 2 1 2 2l2 7v5H5v-5Zm0 0h18M8 22v2m12-2v2M8 17h2m8 0h2" /></template>
                      <template v-else><path d="M7 4h14c1 0 2 1 2 2v15H5V6c0-1 1-2 2-2Zm-2 12h18M9 21v3m10-3v3M9 9h10M9 18h1m8 0h1" /></template>
                    </svg>
                    <span>{{ mode.label }}</span>
                  </button>
                </div>
              </div>
              <article class="legacy-place" :class="{ selected: selectedPlaceId === place.id, swiped: swipedPlaceId === place.id, 'pending-card': activeDay === 'unscheduled' && isUnscheduled(place), expanded: expandedPendingId === place.id }" @click="handlePlaceClick(place)" @touchstart="startPlaceSwipe($event, place.id)" @touchend="endPlaceSwipe($event, place.id)" @touchcancel="placeSwipeStart = null">
                <span class="legacy-order" :class="{ pending: isUnscheduled(place) }" :style="{ '--day-color': isUnscheduled(place) ? '#818A94' : dayColor(place.day) }">
                  <svg viewBox="0 0 40 40" aria-hidden="true"><path :d="isUnscheduled(place) ? PENDING_RING_PATH : STOP_RING_PATH" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" :stroke-dasharray="isUnscheduled(place) ? '1 5' : undefined" /></svg>
                  <span v-if="!isUnscheduled(place)">{{ displayOrder(place, index) }}</span>
                </span>
                <div>
                  <strong class="place-title"><PlaceCategoryIcon :category="place.placeCategory" /><span class="place-name">{{ place.name }}</span><span v-if="place.reservationStatus === 'required'" class="reservation-badge required">约</span><span v-else-if="place.reservationStatus === 'booked'" class="reservation-badge booked">✓</span></strong>
                  <small v-if="isUnscheduled(place)">{{ place.description || '还没安排到某一天' }}</small>
                  <small v-else>Day {{ place.day }}<template v-if="place.description"> · {{ place.description }}</template></small>
                  <div v-if="activeDay === 'unscheduled' && isUnscheduled(place) && expandedPendingId === place.id" class="pending-day-options" @click.stop>
                    <span>放入</span>
                    <button v-for="day in dayOptions" :key="`${place.id}-pending-${day}`" type="button" :style="{ '--day-color': dayColor(day) }" @click="assignDestinationToDay(place, day)">Day {{ day }}</button>
                    <button type="button" class="add-day" aria-label="新增一天并放入" @click="assignDestinationToNewDay(place)">＋</button>
                  </div>
                </div>
                <div v-if="!previewingDraft" class="legacy-place-actions" @click.stop>
                  <button v-if="activeDay === 'unscheduled' && isUnscheduled(place)" class="pending-expand" type="button" :aria-expanded="expandedPendingId === place.id" @click="expandedPendingId = expandedPendingId === place.id ? null : place.id">放入 {{ expandedPendingId === place.id ? '⌃' : '⌄' }}</button>
                  <select v-else class="day-select" :aria-label="`${place.name} 所属 Day`" value="" @change="handleDayAssignment(place, $event)">
                    <option value="" disabled>{{ isUnscheduled(place) ? '放入' : '换天' }}</option>
                    <option v-for="day in dayOptions" :key="`${place.id}-${day}`" :value="String(day)">Day {{ day }}</option>
                    <option value="new">＋ 新一天</option>
                    <option v-if="!isUnscheduled(place)" value="pending">待规划</option>
                  </select>
                  <button :disabled="!canMoveDestination(place.id, 'up')" @click="moveDestination(place.id, 'up')">↑</button>
                  <button :disabled="!canMoveDestination(place.id, 'down')" @click="moveDestination(place.id, 'down')">↓</button>
                  <button class="place-edit" @click="editDestination(place)">编辑</button>
                  <button class="place-delete" @click="removeDestination(place.id)">删除</button>
                </div>
              </article>
            </template>
          </div>
        </div>
      </aside>

      <main class="map-stage">
        <section v-if="AGENT_CHAT_AVAILABLE && agentSession.draftPlan && previewingDraft" class="draft-map-banner">
          <div>
            <strong>正在预览草案</strong>
            <span>尚未保存，正式行程不会改变</span>
          </div>
          <button @click="showFormalRoute">查看正式行程</button>
        </section>
        <div class="map-toolbar paper-panel">
          <AmapPOISearch
            :preferred-city="tripConstraints.city"
            @preview="previewSearchPOI"
          />
          <div class="toolbar-divider" />
          <button class="toolbar-button" :class="{ active: isAddingPoint }" aria-label="地图选点" title="地图选点" @click="toggleAddPointMode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21c-1-2-7-7-7-12a7 7 0 0 1 14 0c0 5-6 10-7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg><span>地图选点</span></button>
          <button class="toolbar-button" aria-label="平移地图" title="平移地图" @click="panMode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/></svg><span>平移</span></button>
          <button class="toolbar-button" aria-label="放大地图" title="放大地图" @click="zoomIn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l5 5M10.5 7v7m-3.5-3.5h7"/></svg><span>放大</span></button>
          <button class="toolbar-button" aria-label="缩小地图" title="缩小地图" @click="zoomOut"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l5 5m-9-10.5h7"/></svg><span>缩小</span></button>
          <button class="toolbar-button" :disabled="!hasMapContent" aria-label="适应路线范围" title="适应路线范围" @click="fitBounds"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/></svg><span>适应范围</span></button>
          <label class="route-line-toggle" title="显示或隐藏路线">
            <input v-model="showRouteLine" type="checkbox" />
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="4" cy="17" r="2"/><circle cx="20" cy="7" r="2"/><path d="M6 16c3-1 3-5 6-5s4-2 6-3" stroke-dasharray="1.5 3"/></svg><span>显示路线</span>
          </label>
          <button v-if="mapRenderError" class="toolbar-button map-retry" @click="retryMapRender">重试地图</button>
        </div>
        <section v-if="poiPreview" class="poi-preview-card" aria-live="polite">
          <button class="poi-preview-close" type="button" aria-label="关闭地点预览" @click="closePOIPreview">×</button>
          <span class="poi-preview-source">高德地点</span>
          <strong>{{ poiPreview.name }}</strong>
          <p v-if="poiPreviewLoading">正在读取地点信息…</p>
          <p v-else>{{ [poiPreview.district || poiPreview.city, poiPreview.address].filter(Boolean).join(' · ') || '地址暂未获取' }}</p>
          <small v-if="poiPreviewError">{{ poiPreviewError }}</small>
          <button type="button" class="poi-placement-toggle" @click="showPoiPlacement = !showPoiPlacement">放到别的天</button>
          <div v-if="showPoiPlacement" class="poi-placement-options">
            <button v-for="day in availablePlacementDays" :key="`poi-day-${day}`" :class="{ active: effectivePoiPlacement === day }" @click="poiPlacementOverride = day">Day {{ day }}</button>
            <button :class="{ active: effectivePoiPlacement === 'unscheduled' }" @click="poiPlacementOverride = 'unscheduled'">待规划</button>
          </div>
          <div class="poi-preview-actions">
            <button type="button" class="text-action" @click="closePOIPreview">取消</button>
            <button type="button" class="poi-add-action" :disabled="poiPreviewLoading" @click="addPreviewedPOI">{{ poiAddLabel }}</button>
          </div>
        </section>
        <AmapMapComponent ref="mapRef" class="map-canvas" @point-form-open="pointFormOpen = $event" />
      </main>

      <aside ref="rightPanelRef" class="agent-panel paper-panel" :class="{ 'mobile-agent-visible': mobileAgentOpen }">
        <header class="panel-title agent-title">
          <CrossCompanion class="agent-companion" :status="agentVisualState" />
          <div class="agent-heading-copy">
            <h2>CROSS</h2>
            <p class="agent-status">{{ agentStatusLabel }}</p>
          </div>
          <button class="icon-button" title="关闭 CROSS" @click="closeAgentPanel">›</button>
        </header>

        <div v-if="rightCollapsed" class="collapsed-rail right-rail">
          <button class="rail-button" title="展开 AI 助手" @click="rightCollapsed = false">AI</button>
        </div>

        <template v-else>
          <section v-if="AGENT_CHAT_AVAILABLE && (hasTripContext || activeConstraint)" class="trip-brief" :class="{ editing: activeConstraint }">
            <span class="brief-label">这次旅行</span>

            <div class="brief-item" :class="{ active: activeConstraint === 'destination' }">
              <button class="brief-row" @click="toggleConstraint('destination')">
                <span>目的地</span><strong>{{ tripConstraints.city || '想去哪里？' }}</strong><i>›</i>
              </button>
              <div v-if="activeConstraint === 'destination'" class="brief-editor destination-editor">
                <label for="destination-search">想去哪里？</label>
                <input
                  id="destination-search"
                  v-model.trim="destinationQuery"
                  placeholder="搜索城市或地区"
                  autocomplete="off"
                  @keydown.enter.prevent="useDestinationQuery"
                />
                <div v-if="tripConstraints.city" class="destination-group">
                  <small>当前行程</small>
                  <button @click="selectDestination(tripConstraints.city)">
                    <span>⌖</span><strong>{{ tripConstraints.city }}</strong><em>{{ destinations.length }} 个地点</em>
                  </button>
                </div>
                <div v-if="destinationSuggestions.length" class="destination-group">
                  <small>{{ destinationQuery ? '搜索建议' : '最近与常用' }}</small>
                  <button v-for="city in destinationSuggestions" :key="city" @click="selectDestination(city)">
                    <span>↗</span><strong>{{ city }}</strong><em>城市</em>
                  </button>
                </div>
                <button v-if="destinationQuery && !destinationSuggestions.includes(destinationQuery)" class="use-query" @click="useDestinationQuery">
                  使用“{{ destinationQuery }}”作为目的地
                </button>
                <button class="defer-action" @click="activeConstraint = null">还没确定，先和 CROSS 聊聊</button>
              </div>
            </div>

            <div class="brief-item" :class="{ active: activeConstraint === 'dates' }">
              <button class="brief-row" @click="toggleConstraint('dates')">
                <span>日期</span><strong>{{ dateSummary }}</strong><i>›</i>
              </button>
              <div v-if="activeConstraint === 'dates'" class="brief-editor date-editor">
                <label>什么时候出发？</label>
                <el-date-picker
                  v-model="startDateInput"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="选择出发日期"
                  @change="applyStartDate"
                />
                <label for="trip-days">旅行天数</label>
                <input id="trip-days" v-model.number="tripConstraints.days" type="number" min="1" max="14" @change="applyTripDuration" />
                <small>整趟旅行只设置一次出发日期，Day 日期会自动顺延。</small>
                <button class="defer-action" @click="markDatesFlexible">日期还没确定</button>
              </div>
            </div>

            <div class="brief-item" :class="{ active: activeConstraint === 'pace' }">
              <button class="brief-row" @click="toggleConstraint('pace')">
                <span>节奏</span><strong>{{ paceSummary }}</strong><i>›</i>
              </button>
              <div v-if="activeConstraint === 'pace'" class="brief-editor pace-editor">
                <label>一天想怎么安排？</label>
                <button v-for="option in paceOptions" :key="option.value" :class="{ selected: tripConstraints.pacePreference === option.value }" @click="selectPace(option.value)">
                  <strong>{{ option.value }}</strong><span>{{ option.detail }}</span>
                </button>
              </div>
            </div>
          </section>

          <div ref="agentScrollRef" class="agent-scroll">
            <section v-if="!AGENT_CHAT_AVAILABLE && !unavailableQuestion" class="agent-state agent-unavailable">
              <p class="state-title">这个功能还在开发中</p>
              <p>暂时还不能和我聊天。</p>
              <p>不过这些现在就能自己完成：</p>
              <ul>
                <li>搜索地点，或点地图加点</li>
                <li>把待规划的地点放进某一天</li>
                <li>调整每天的先后顺序</li>
              </ul>
              <p>开放之后，这里就能用了。</p>
              <div class="unavailable-actions">
                <button type="button" @click="focusPoiSearch">去添加地点</button>
                <button type="button" @click="openPendingFromAgent">看待规划</button>
              </div>
            </section>
            <template v-else-if="!AGENT_CHAT_AVAILABLE">
              <article class="chat-message user">
                <div class="message-meta"><time>刚刚</time></div>
                <div class="message-content"><p>{{ unavailableQuestion }}</p></div>
              </article>
              <article class="chat-message assistant unavailable-reply">
                <div class="message-content">
                  <p><strong>这个功能还在开发中</strong></p>
                  <p>暂时帮不上忙。先在左边把地点放进某一天，我在这儿陪你看着。</p>
                </div>
                <button type="button" class="text-action" @click="openPendingFromAgent">去待规划</button>
              </article>
            </template>
            <template v-else>
            <section v-if="agentMessages.length === 0" class="agent-state empty-agent">
              <p class="state-title">还没有路线，先说一个想去的地方</p>
              <p>我们可以从零开始规划，也可以先导入已有路线，再一起调整。</p>
              <div class="planning-entry-list">
                <button :class="{ active: agentEntryMode === 'create' }" @click="selectAgentEntryMode('create')">
                  <strong>从零开始规划</strong>
                  <span>告诉我城市、天数和一定想去的地方，我们先排一份草案。</span>
                </button>
                <button :class="{ active: agentEntryMode === 'import' }" @click="selectAgentEntryMode('import')">
                  <strong>导入已有路线</strong>
                  <span>把已有路线粘贴进来，我会先整理日期、地点和顺序。</span>
                </button>
              </div>
            </section>
            <article v-for="message in agentMessages" :key="message.id" class="chat-message" :class="[message.role, message.status]">
              <div class="message-meta">
                <span v-if="message.status === 'sending'" class="thinking-mark" aria-label="正在处理">
                  <i></i><i></i><i></i><i></i>
                </span>
                <time>{{ formatMessageTime(message.createdAt) }}</time>
              </div>
              <div v-if="!message.draftPlan" class="message-content" v-html="renderMessageContent(message.content)"></div>
              <section v-if="message.activities?.length" class="activity-panel">
                <button class="activity-heading" @click="toggleActivities(message.id)">
                  <span>{{ message.status === 'sending' ? '正在梳理这次行程' : message.status === 'failed' ? '这次没有完成' : message.status === 'superseded' ? '已按新要求重新处理' : '这次做了什么' }}</span>
                  <i>{{ shouldShowActivities(message) ? '−' : '+' }}</i>
                </button>
                <ol v-if="shouldShowActivities(message)" class="activity-list">
                  <li v-for="activity in message.activities" :key="`${message.id}-${activity.id}`" :class="activity.status">
                    <span class="activity-mark">{{ activity.status === 'complete' ? '✓' : activity.status === 'failed' ? '!' : activity.status === 'superseded' ? '—' : '●' }}</span>
                    <div><strong>{{ activity.label }}</strong><small v-if="activity.detail">{{ activity.detail }}</small></div>
                  </li>
                </ol>
              </section>
              <ul v-if="message.changes?.length" class="change-list">
                <li v-for="change in message.changes" :key="`${message.id}-${change.type}-${change.message}`">{{ change.message }}</li>
              </ul>
              <section v-if="message.candidateSet" class="candidate-result">
                <header>
                  <div>
                    <strong>地点候选 · {{ message.candidateSet.query }}</strong>
                    <small>来自高德 POI，勾选只是告诉 CROSS 你的偏好，还不会加入地图或行程。</small>
                  </div>
                </header>
                <div class="candidate-list">
                  <label v-for="candidate in message.candidateSet.candidates" :key="candidate.id" class="candidate-row">
                    <input
                      type="checkbox"
                      :checked="isCandidateSelected(message.candidateSet.id, candidate.id, message.candidateSet.selectedIds)"
                      @change="toggleCandidate(message.candidateSet.id, candidate.id, message.candidateSet.selectedIds)"
                    />
                    <span><strong>{{ candidate.name }}</strong><small>{{ candidate.address || candidate.city || '地址待补充' }}</small></span>
                  </label>
                </div>
                <button v-if="message.candidateSet.status === 'awaiting_selection'" class="candidate-continue" @click="confirmCandidateSelection(message)">按这些地点继续</button>
              </section>
              <section v-if="message.generationConfirmation && !message.draftPlan" class="generation-confirmation">
                <strong>准备生成草案</strong>
                <p>{{ message.generationConfirmation.city }} · {{ message.generationConfirmation.days }} 天 · {{ message.generationConfirmation.pace }}节奏</p>
                <small>已选地点：{{ message.generationConfirmation.selectedPlaces.map((item) => item.name).join('、') || '暂未选择具体地点' }}</small>
                <button class="confirm-action" @click="confirmDraftGeneration">开始生成草案</button>
              </section>
              <section v-if="message.draftPlan" class="draft-result-card">
                <header>
                  <div>
                    <strong>草案预览 · {{ message.draftPlan.route.name }}</strong>
                    <small>尚未保存，不会覆盖正式行程</small>
                  </div>
                  <button class="text-action" @click="focusDraftPreview">查看地图</button>
                </header>
                <section v-if="message.draftExplanation" class="draft-basis">
                  <strong>这样安排的依据</strong>
                  <ul>
                    <li v-for="basis in message.draftExplanation.basis" :key="basis">{{ basis }}</li>
                  </ul>
                </section>
                <ol class="draft-days">
                  <li v-for="day in message.draftExplanation?.days || draftDays(message.draftPlan)" :key="`${message.id}-draft-day-${day.day}`">
                    <strong>Day {{ day.day }}</strong>
                    <span>{{ day.places.join(' → ') }}</span>
                    <small>{{ day.reason }}</small>
                  </li>
                </ol>
                <section v-if="message.draftExplanation?.evidence?.length" class="draft-evidence">
                  <strong>信息边界</strong>
                  <span v-for="item in message.draftExplanation.evidence" :key="`${item.type}-${item.label}`">{{ item.label }}</span>
                </section>
                <div v-if="message.proposal?.status === 'pending'" class="draft-result-actions">
                  <button class="confirm-action" @click="confirmAgentProposal(message)">写入行程</button>
                  <button class="text-action" @click="fillAgentRequest('把这份草案安排得轻松一点')">再调整</button>
                </div>
              </section>
              <section v-if="message.proposal && !message.draftPlan" class="proposal-card">
                <strong>{{ message.proposal.kind === 'create' ? '待保存的旅行草案' : '待确认的行程修改' }}</strong>
                <p>{{ message.proposal.summary }}</p>
                <ol v-if="message.proposal.segments?.length" class="proposal-segments">
                  <li v-for="segment in message.proposal.segments" :key="`${message.proposal.id}-${segment.city}`">
                    <strong>{{ segment.city }}</strong><span>{{ segment.days }} 天</span><small v-if="segment.reason">{{ segment.reason }}</small>
                  </li>
                </ol>
                <div v-if="message.proposal.status === 'pending'" class="proposal-actions">
                  <button class="confirm-action" @click="confirmAgentProposal(message)">{{ message.proposal.kind === 'create' ? '写入行程' : '确认应用' }}</button>
                  <button class="text-action" @click="rejectAgentProposal(message)">{{ message.proposal.kind === 'create' ? '暂不保存' : '暂不修改' }}</button>
                </div>
                <small v-else>{{ message.proposal.status === 'applied' ? '已应用到地图与日程' : message.proposal.status === 'rejected' ? '已拒绝，本次没有修改行程' : '提案已失效' }}</small>
              </section>
              <div v-if="message.status === 'complete' && message.suggestions?.length" class="follow-up-suggestions">
                <button v-for="suggestion in message.suggestions" :key="`${message.id}-${suggestionKey(suggestion)}`" @click="handleSuggestion(message, suggestion)">
                  {{ suggestionLabel(suggestion) }}
                </button>
              </div>
              <small v-if="message.status === 'superseded'">已收到新要求，本次结果不会应用</small>
              <small v-else-if="message.status === 'failed'">发送失败，行程未修改</small>
            </article>
            <div v-if="undoSnapshot" class="undo-bar">
              <span>最近一次 AI 调整可以撤销</span>
              <button class="text-action" @click="undoLastAgentChange">撤销</button>
            </div>
            </template>
          </div>

          <footer class="agent-input">
            <CrossCompanion class="input-companion" :status="agentVisualState" />
            <div v-if="AGENT_CHAT_AVAILABLE && hasTripContext" class="agent-input-suggestions" aria-label="常用调整">
              <button type="button" @click="fillAgentRequest('把这份安排得轻松一点')">再轻松一点</button>
              <button type="button" @click="fillAgentRequest('帮我检查每天的移动距离')">检查移动距离</button>
            </div>
            <textarea
              ref="agentInputRef"
              v-model="agentRequest"
              rows="2"
              :placeholder="agentPlaceholder"
              @focus="openMobileAgent"
              @keydown.enter.exact.prevent="sendAgentMessage()"
            />
            <button class="send-button" :disabled="!agentRequest.trim()" @click="sendAgentMessage()">
              {{ isAgentLoading ? '追加' : '发送' }}
            </button>
          </footer>
        </template>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTripStore } from '@/store/trip'
import AmapMapComponent from '@/components/AmapMapComponent.vue'
import AmapPOISearch from '@/components/AmapPOISearch.vue'
import CrossCompanion from '@/components/CrossCompanion.vue'
import PlaceCategoryIcon from '@/components/PlaceCategoryIcon.vue'
import {
  agentSessionKey,
  agentUndoKey,
  clearLegacyAgentStorageOnce,
  createDraftTripId,
  createSavedTripId,
  getActiveTripId,
  migrateAgentStorage,
  setActiveTripId
} from '@/lib/agentSessionStorage'
import { dayColor } from '@/lib/dayPalette'
import { STOP_RING_PATH, PENDING_RING_PATH } from '@/lib/stopMarker'
import { promptRouteName } from '@/lib/routeNamePrompt'
import type { AgentActivity, AgentChatResponse, AgentInteraction, AgentMessage, AgentPlanResult, AgentSession, AgentSuggestion, Destination, TransportMode, TransportSegment, TripSnapshot } from '@/types'

type POIPreview = {
  id: string
  name: string
  city: string
  district: string
  address: string
  coordinates: [number, number]
  sourceLabel: string
}

const tripStore = useTripStore()
const route = useRoute()
const AGENT_CHAT_AVAILABLE = false
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api'
const mapRef = ref<InstanceType<typeof AmapMapComponent>>()
const pointFormOpen = ref(false)
const leftPanelRef = ref<HTMLElement>()
const rightPanelRef = ref<HTMLElement>()
const mapCenter = ref<[number, number] | null>(null)
const poiPreview = ref<POIPreview | null>(null)
const poiPreviewLoading = ref(false)
const poiPreviewError = ref('')
const showPoiPlacement = ref(false)
const poiPlacementOverride = ref<number | 'unscheduled' | null>(null)
let poiPreviewRequest = 0
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
type MobileSheetLevel = 'collapsed' | 'half' | 'expanded'
const mobileSheet = ref<MobileSheetLevel>('half')
const previousMobileSheet = ref<MobileSheetLevel>('half')
const mobileAgentOpen = ref(false)
let sheetDragStartY = 0
let sheetDragCurrentY = 0
const activeConstraint = ref<'destination' | 'dates' | 'pace' | null>(null)
const isAddingPoint = ref(false)
const mapRenderError = ref(false)
const activeRequestId = ref<string | null>(null)
const isAgentLoading = computed(() => Boolean(activeRequestId.value))
let activeRequestController: AbortController | null = null
let activeInstructionMessageIds: string[] = []
let activeAssistantMessage: AgentMessage | null = null
const showRouteLine = ref(true)
const saveFeedback = ref(false)
let saveFeedbackTimer: ReturnType<typeof setTimeout> | undefined
const activeDay = ref<number | 'overview' | 'unscheduled'>('overview')
const previewingDraft = ref(false)
const selectedPlaceId = ref<string | null>(null)
const swipedPlaceId = ref<string | null>(null)
let placeSwipeStart: { id: string; x: number; y: number } | null = null
let suppressPlaceClickUntil = 0
const expandedTransportSegmentId = ref<string | null>(null)
const expandedPendingId = ref<string | null>(null)
const reservationListOpen = ref(false)
const agentRequest = ref('')
const unavailableQuestion = ref('')
const agentEntryMode = ref<'create' | 'import'>('create')
const candidateSelections = ref<Record<string, string[]>>({})
const agentScrollRef = ref<HTMLElement>()
const agentInputRef = ref<HTMLTextAreaElement>()
const destinationQuery = ref('')
const startDateInput = ref('')
const expandedActivityIds = ref<string[]>([])
const recentCities = ref<string[]>(loadRecentCities())

const COMMON_CITIES = ['北京', '上海', '南京', '杭州', '苏州', '成都', '重庆', '西安', '广州', '深圳', '厦门', '青岛']
const paceOptions = [
  { value: '轻松', detail: '每天约 2–3 个地点，留出休息和临时调整时间' },
  { value: '适中', detail: '每天约 3–4 个地点，游览与移动相对平衡' },
  { value: '紧凑', detail: '每天约 4–5 个地点，适合希望多看一些的旅行' }
]
const tripConstraints = reactive({ city: '', days: 0, pacePreference: '', startDate: '', endDate: '', datesFlexible: false })
const destinations = computed(() => tripStore.destinations)
const reservationsDue = computed(() => destinations.value.filter((place) => place.reservationStatus === 'required'))
const reservationDueCount = computed(() => reservationsDue.value.length)
const currentRoute = computed(() => tripStore.currentRoute)
clearLegacyAgentStorageOnce()
const initialTripId = currentRoute.value?.id || getActiveTripId() || createDraftTripId()
const activeTripId = ref(initialTripId)
setActiveTripId(initialTripId)
const agentSession = ref<AgentSession>(loadAgentSession(initialTripId))
const agentMessages = computed(() => agentSession.value.messages)
const lastAssistantMessage = computed(() => [...agentMessages.value].reverse().find((message) => message.role === 'assistant'))
const agentVisualState = computed<'idle' | 'thinking' | 'complete' | 'error'>(() => {
  if (!AGENT_CHAT_AVAILABLE) return 'idle'
  if (isAgentLoading.value) return 'thinking'
  if (lastAssistantMessage.value?.status === 'failed') return 'error'
  if (lastAssistantMessage.value?.status === 'complete' && (lastAssistantMessage.value.draftPlan || lastAssistantMessage.value.proposal)) return 'complete'
  return 'idle'
})
const agentStatusLabel = computed(() => !AGENT_CHAT_AVAILABLE
  ? '对话还在准备中'
  : ({
      idle: '我们从哪里开始？',
      thinking: '正在看地图…',
      complete: '排好了，看看合不合适',
      error: '刚才没有完成，再试一次'
    }[agentVisualState.value]))
const mobileCompanionCopy = computed(() => {
  if (!AGENT_CHAT_AVAILABLE) return '对话还在准备中'
  if (agentVisualState.value === 'thinking') return '正在看地图…'
  if (agentVisualState.value === 'complete') return '路线排好了'
  if (!destinations.value.length) return '先说一个想去的地方'
  return typeof activeDay.value === 'number' ? `要一起看看 Day ${activeDay.value} 吗？` : '要帮你排一排吗？'
})
const mobileSheetLabel = computed(() => ({
  collapsed: '展开地点列表',
  half: '展开或收起地点列表',
  expanded: '收起地点列表'
}[mobileSheet.value]))
const undoSnapshot = ref<TripSnapshot | null>(loadUndoSnapshot(initialTripId))
const hasTripContext = computed(() => agentMessages.value.length > 0 || destinations.value.length > 0 || Boolean(tripConstraints.city || tripConstraints.days))
const destinationSuggestions = computed(() => {
  const query = destinationQuery.value.toLowerCase()
  return [...new Set([...recentCities.value, ...COMMON_CITIES])]
    .filter((city) => city !== tripConstraints.city && (!query || city.toLowerCase().includes(query)))
    .slice(0, 6)
})
const dateSummary = computed(() => {
  if (tripConstraints.startDate) {
    return `${formatShortDate(tripConstraints.startDate)}出发 · ${tripConstraints.days || 1} 天`
  }
  if (tripConstraints.datesFlexible) return tripConstraints.days ? `日期待定 · ${tripConstraints.days} 天` : '日期待定'
  return tripConstraints.days ? `${tripConstraints.days} 天` : '什么时候出发？'
})
const detectedPace = computed(() => {
  const score = { '轻松': 1, '适中': 2, '紧凑': 3 } as const
  return tripStore.schedule.reduce<'轻松' | '适中' | '紧凑' | ''>((result, day) => {
    if (!day.detectedPace) return result
    return !result || score[day.detectedPace] > score[result] ? day.detectedPace : result
  }, '')
})
const paceSummary = computed(() => tripConstraints.pacePreference
  ? `偏好：${tripConstraints.pacePreference}`
  : detectedPace.value ? `目前安排偏${detectedPace.value}` : '想走得轻松还是紧凑？')
const agentPlaceholder = computed(() => !AGENT_CHAT_AVAILABLE
  ? '对话功能开发中，暂未开放'
  : agentMessages.value.length
  ? '继续告诉 CROSS 怎么调整，例如：第二天轻松一点…'
  : agentEntryMode.value === 'import'
    ? '把已有路线粘贴到这里，最好保留“第1天 / 第2天”等结构'
    : '例如：南京玩 2 天，想看历史建筑，节奏轻松一点')
const displayedDestinations = computed(() => previewingDraft.value
  ? agentSession.value.draftPlan?.route.destinations || []
  : destinations.value)
const scheduledDestinations = computed(() => displayedDestinations.value.filter((place) => place.planningStatus === 'scheduled' || !place.planningStatus))
const routeEndpoints = computed(() => {
  const stops = destinations.value.filter((place) => place.planningStatus === 'scheduled' || !place.planningStatus).sort((a, b) =>
    Number(a.day || 1) - Number(b.day || 1) ||
    Number(a.withinDayOrder || a.order) - Number(b.withinDayOrder || b.order)
  )
  return stops.length > 1 ? `${stops[0].name} → ${stops[stops.length - 1].name}` : ''
})
const unscheduledDestinations = computed(() => displayedDestinations.value.filter((place) => place.planningStatus === 'unscheduled' || place.planningStatus === 'candidate'))
const formalDays = computed(() => groupByDay(scheduledDestinations.value))
const lastOccupiedDay = computed(() => Math.max(0, ...formalDays.value.map((item) => item.day)))
const dayOptions = computed(() => {
  const count = Math.min(14, Math.max(lastOccupiedDay.value, Number(tripConstraints.days) || 1))
  return Array.from({ length: count }, (_, index) => index + 1)
})
const visibleDestinations = computed(() => {
  if (activeDay.value === 'overview') return displayedDestinations.value
  if (activeDay.value === 'unscheduled') return unscheduledDestinations.value
  return displayedDestinations.value.filter((place) => Number(place.day) === activeDay.value)
})
const transportModes: Array<{ value: TransportMode; label: string }> = [
  { value: 'walk', label: '步行' },
  { value: 'cycle', label: '骑行' },
  { value: 'drive', label: '打车' },
  { value: 'transit', label: '公共交通' }
]
const hasMapContent = computed(() => destinations.value.length > 0 || Boolean(agentSession.value.draftPlan?.route.destinations.length))
const routeDayCount = computed(() => Math.max(dayOptions.value.length, 1))
const lastDayHasPlaces = computed(() => scheduledDestinations.value.some((place) => Number(place.day || 1) === routeDayCount.value))
function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} 米` : `${(meters / 1000).toFixed(1)} 公里`
}

function walkingDistanceForDay(day: number) {
  const segments = (tripStore.transportSegments || []).filter((segment) => segment.day === day && segment.mode === 'walk')
  if (segments.some((segment) => segment.status !== 'ready')) return '待计算'
  const meters = segments
    .reduce((sum, segment) => sum + (segment.distanceMeters || 0), 0)
  return formatDistance(meters)
}

const routeDistanceSummary = computed(() => {
  const segments = (tripStore.transportSegments || []).filter((segment) => segment.mode === 'walk')
  if (segments.some((segment) => segment.status !== 'ready')) return '待计算'
  const meters = segments
    .reduce((sum, segment) => sum + (segment.distanceMeters || 0), 0)
  return formatDistance(meters)
})
const availablePlacementDays = computed(() => dayOptions.value.length ? dayOptions.value : [1])
const effectivePoiPlacement = computed<number | 'unscheduled'>(() => poiPlacementOverride.value
  ?? (typeof activeDay.value === 'number' ? activeDay.value : 'unscheduled'))
const poiAddLabel = computed(() => effectivePoiPlacement.value === 'unscheduled'
  ? '加入待规划'
  : `加入 Day ${effectivePoiPlacement.value}`)

function transportSegmentBefore(index: number) {
  if (previewingDraft.value || index < 1) return undefined
  const previous = visibleDestinations.value[index - 1]
  const current = visibleDestinations.value[index]
  if (!previous || !current || Number(previous.day) !== Number(current.day)) return undefined
  return (tripStore.transportSegments || []).find((segment) =>
    segment.fromDestinationId === previous.id && segment.toDestinationId === current.id
  )
}

function transportSummary(segment: TransportSegment) {
  const mode = transportModes.find((item) => item.value === segment.mode)?.label || '交通'
  const distance = (segment.distanceMeters || 0) < 1000
    ? `${Math.round(segment.distanceMeters || 0)} 米`
    : `${((segment.distanceMeters || 0) / 1000).toFixed(1)} 公里`
  return `${mode} · ${distance} · ${Math.ceil((segment.durationSeconds || 0) / 60)} 分钟`
}

function footprintCount(segment: TransportSegment) {
  return Math.min(3, Math.max(1, Math.ceil((segment.distanceMeters || 0) / 800)))
}

function toggleTransportSegment(id: string) {
  expandedTransportSegmentId.value = expandedTransportSegmentId.value === id ? null : id
}

function setMobileSheet(level: MobileSheetLevel) {
  mobileSheet.value = level
  void nextTick(() => window.dispatchEvent(new Event('resize')))
}

function cycleMobileSheet() {
  setMobileSheet(mobileSheet.value === 'collapsed' ? 'half' : mobileSheet.value === 'half' ? 'expanded' : 'collapsed')
}

function startSheetDrag(event: PointerEvent) {
  sheetDragStartY = event.clientY
  sheetDragCurrentY = event.clientY
  event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId)
}

function moveSheetDrag(event: PointerEvent) {
  sheetDragCurrentY = event.clientY
}

function finishSheetDrag(event: PointerEvent) {
  sheetDragCurrentY = event.clientY
  const distance = sheetDragCurrentY - sheetDragStartY
  if (Math.abs(distance) < 48) {
    cycleMobileSheet()
  } else if (distance < 0) {
    setMobileSheet(mobileSheet.value === 'collapsed' ? 'half' : 'expanded')
  } else {
    setMobileSheet(mobileSheet.value === 'expanded' ? 'half' : 'collapsed')
  }
  event.currentTarget instanceof HTMLElement && event.currentTarget.releasePointerCapture(event.pointerId)
}

function cancelSheetDrag() {
  sheetDragStartY = 0
  sheetDragCurrentY = 0
}

function openMobileAgent() {
  if (!mobileAgentOpen.value) previousMobileSheet.value = mobileSheet.value
  mobileAgentOpen.value = true
  rightCollapsed.value = false
  setMobileSheet('collapsed')
}

function closeAgentPanel() {
  if (window.innerWidth <= 900) {
    mobileAgentOpen.value = false
    setMobileSheet(previousMobileSheet.value)
    return
  }
  rightCollapsed.value = true
}

function focusPoiSearch() {
  closeAgentPanel()
  activeDay.value = 'overview'
  mapRef.value?.setVisibleDay('overview')
  void nextTick(() => document.querySelector<HTMLInputElement>('.poi-search .search-input')?.focus())
}

function openPendingFromAgent() {
  closeAgentPanel()
  selectDay('unscheduled')
  if (window.innerWidth <= 900) setMobileSheet('half')
}

function revealMap() {
  mobileAgentOpen.value = false
  setMobileSheet('collapsed')
  void nextTick(() => {
    window.dispatchEvent(new Event('resize'))
    if (hasMapContent.value) mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: visibleDestinations.value })
  })
}

function loadRecentCities(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem('cross:recent-cities') || '[]')
    return Array.isArray(saved) ? saved.filter((city) => typeof city === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

function toggleConstraint(section: 'destination' | 'dates' | 'pace') {
  activeConstraint.value = activeConstraint.value === section ? null : section
  if (activeConstraint.value === 'destination') destinationQuery.value = ''
}

function selectDestination(city: string) {
  const value = city.trim()
  if (!value) return
  tripConstraints.city = value
  recentCities.value = [value, ...recentCities.value.filter((item) => item !== value)].slice(0, 6)
  localStorage.setItem('cross:recent-cities', JSON.stringify(recentCities.value))
  destinationQuery.value = ''
  activeConstraint.value = null
}

function useDestinationQuery() {
  selectDestination(destinationQuery.value)
}

function formatShortDate(value: string) {
  const [, month, day] = value.split('-').map(Number)
  return month && day ? `${month}月${day}日` : value
}

function syncTripDates() {
  if (!tripConstraints.startDate) return
  const days = Math.min(14, Math.max(1, Number(tripConstraints.days) || routeDayCount.value))
  tripConstraints.days = days
  const end = new Date(`${tripConstraints.startDate}T00:00:00`)
  end.setDate(end.getDate() + days - 1)
  tripConstraints.endDate = end.toISOString().slice(0, 10)
  tripStore.setTripStartDate(tripConstraints.startDate)
  persistAgentSession()
}

function applyStartDate(value: string | null) {
  if (!value) return
  tripConstraints.startDate = value
  tripConstraints.datesFlexible = false
  syncTripDates()
  activeConstraint.value = null
}

function applyTripDuration() {
  const requestedDays = Number(tripConstraints.days) || 1
  tripConstraints.days = Math.min(14, Math.max(1, requestedDays, lastOccupiedDay.value))
  if (tripConstraints.days !== requestedDays) ElMessage.warning('旅行天数为 1–14 天；已有地点的 Day 不能直接删除。')
  tripStore.markRouteDirty()
  syncTripDates()
}

function addDay() {
  if (routeDayCount.value >= 14) return
  tripConstraints.days = routeDayCount.value + 1
  tripStore.markRouteDirty()
  syncTripDates()
}

function removeLastDay() {
  if (routeDayCount.value <= 1 || lastDayHasPlaces.value) return
  if (activeDay.value === routeDayCount.value) selectDay('overview')
  tripConstraints.days = routeDayCount.value - 1
  tripStore.markRouteDirty()
  syncTripDates()
}

function markDatesFlexible() {
  tripConstraints.startDate = ''
  tripConstraints.endDate = ''
  tripConstraints.datesFlexible = true
  tripStore.setTripStartDate('')
  startDateInput.value = ''
  activeConstraint.value = null
}

function selectPace(pace: string) {
  tripConstraints.pacePreference = pace
  activeConstraint.value = null
}

function toggleActivities(messageId: string) {
  expandedActivityIds.value = expandedActivityIds.value.includes(messageId)
    ? expandedActivityIds.value.filter((id) => id !== messageId)
    : [...expandedActivityIds.value, messageId]
}

function shouldShowActivities(message: AgentMessage) {
  return message.status === 'sending' || expandedActivityIds.value.includes(message.id)
}

function upsertActivity(message: AgentMessage, activity: AgentActivity) {
  const activities = message.activities || (message.activities = [])
  const index = activities.findIndex((item) => item.id === activity.id)
  if (index >= 0) activities[index] = activity
  else activities.push(activity)
  if (!expandedActivityIds.value.includes(message.id)) expandedActivityIds.value = [...expandedActivityIds.value, message.id]
  persistAgentSession()
  void nextTick(scrollAgentToBottom)
}

function emptyConstraints() {
  return { city: '', days: 0, pacePreference: '', startDate: '', endDate: '', datesFlexible: false }
}

function loadAgentSession(tripId: string): AgentSession {
  try {
    const saved = localStorage.getItem(agentSessionKey(tripId))
    if (saved) {
      const parsed = JSON.parse(saved) as AgentSession
      return {
        ...parsed,
        tripId,
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        constraints: { ...emptyConstraints(), ...parsed.constraints, pacePreference: parsed.constraints?.pacePreference || parsed.constraints?.pace || '' },
        pendingTask: parsed.pendingTask || null,
        planRevision: Number(parsed.planRevision) || 0,
        draftPlan: parsed.draftPlan || null,
        draftTrip: parsed.draftTrip || null
      }
    }
  } catch (error) {
    console.warn('Failed to restore agent session:', error)
  }
  return {
    id: `agent-session-${Date.now()}`,
    tripId,
    messages: [],
    constraints: emptyConstraints(),
    pendingTask: null,
    planRevision: 0,
    draftPlan: null,
    draftTrip: null,
    updatedAt: new Date().toISOString()
  }
}

function loadUndoSnapshot(tripId: string): TripSnapshot | null {
  try {
    const saved = localStorage.getItem(agentUndoKey(tripId))
    return saved ? JSON.parse(saved) as TripSnapshot : null
  } catch {
    return null
  }
}

function persistAgentSession() {
  agentSession.value.tripId = activeTripId.value
  agentSession.value.constraints = { ...tripConstraints }
  agentSession.value.updatedAt = new Date().toISOString()
  localStorage.setItem(agentSessionKey(activeTripId.value), JSON.stringify(agentSession.value))
}

function switchAgentSession(tripId: string) {
  if (!tripId || tripId === activeTripId.value) return
  if (activeAssistantMessage?.status === 'sending') {
    activeAssistantMessage.status = 'superseded'
    activeAssistantMessage.content = '已切换到另一条路线，本次处理已停止。'
    activeAssistantMessage.activities = activeAssistantMessage.activities?.map((activity) =>
      activity.status === 'running' ? { ...activity, status: 'superseded' } : activity
    )
  }
  persistAgentSession()
  activeRequestController?.abort()
  activeRequestController = null
  activeRequestId.value = null
  activeInstructionMessageIds = []
  activeAssistantMessage = null
  activeTripId.value = tripId
  setActiveTripId(tripId)
  agentSession.value = loadAgentSession(tripId)
  previewingDraft.value = AGENT_CHAT_AVAILABLE && Boolean(agentSession.value.draftPlan)
  activeDay.value = 'overview'
  mapRef.value?.setVisibleDay('overview')
  mapRef.value?.setDraftDestinations(agentSession.value.draftPlan?.route.destinations || [])
  mapRef.value?.setDraftPreviewMode(previewingDraft.value)
  Object.assign(tripConstraints, emptyConstraints(), agentSession.value.constraints)
  if (currentRoute.value?.id === tripId) tripConstraints.startDate = tripStore.tripStartDate
  startDateInput.value = tripConstraints.startDate || ''
  undoSnapshot.value = loadUndoSnapshot(tripId)
  expandedActivityIds.value = []
  void nextTick(scrollAgentToBottom)
}

function addAgentMessage(message: AgentMessage) {
  agentSession.value.messages.push(message)
  persistAgentSession()
  void nextTick(scrollAgentToBottom)
}

function bumpPlanRevision() {
  agentSession.value.planRevision = (Number(agentSession.value.planRevision) || 0) + 1
  persistAgentSession()
}

function scrollAgentToBottom() {
  if (agentScrollRef.value) agentScrollRef.value.scrollTop = agentScrollRef.value.scrollHeight
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function escapeMessageHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function formatMessageInline(value: string) {
  return escapeMessageHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function renderMessageContent(content: string) {
  const output: string[] = []
  let list: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (list) output.push(`</${list}>`)
    list = null
  }
  for (const rawLine of String(content || '').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      closeList()
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const bullet = line.match(/^[*-]\s+(.+)$/)
    const ordered = line.match(/^\d+[.)]\s+(.+)$/)
    if (heading) {
      closeList()
      output.push(`<h${heading[1].length}>${formatMessageInline(heading[2])}</h${heading[1].length}>`)
    } else if (bullet || ordered) {
      const nextList = bullet ? 'ul' : 'ol'
      if (list !== nextList) {
        closeList()
        list = nextList
        output.push(`<${list}>`)
      }
      output.push(`<li>${formatMessageInline((bullet || ordered)?.[1] || '')}</li>`)
    } else {
      closeList()
      output.push(`<p>${formatMessageInline(line)}</p>`)
    }
  }
  closeList()
  return output.join('')
}

function fillAgentRequest(value: string) {
  agentRequest.value = value
  void nextTick(() => agentInputRef.value?.focus())
}

function selectAgentEntryMode(mode: 'create' | 'import') {
  agentEntryMode.value = mode
  void nextTick(() => agentInputRef.value?.focus())
}

function draftDays(plan: AgentPlanResult) {
  const grouped = new Map<number, string[]>()
  for (const place of plan.route.destinations) {
    const day = Number(place.day) || 1
    const places = grouped.get(day) || []
    places.push(place.name)
    grouped.set(day, places)
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([day, places]) => ({
    day,
    places,
    reason: '这是草案安排，确认前可以继续替换地点或调整节奏。'
  }))
}

function focusDraftPreview() {
  if (!agentSession.value.draftPlan) return
  revealMap()
  previewingDraft.value = true
  activeDay.value = 'overview'
  selectedPlaceId.value = null
  mapRef.value?.setSelectedDestination(null)
  mapRef.value?.setDraftPreviewMode(true)
  mapRef.value?.setVisibleDay('overview')
  mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: agentSession.value.draftPlan.route.destinations })
}

function showFormalRoute() {
  revealMap()
  previewingDraft.value = false
  activeDay.value = 'overview'
  selectedPlaceId.value = null
  mapRef.value?.setSelectedDestination(null)
  mapRef.value?.setDraftPreviewMode(false)
  mapRef.value?.setVisibleDay('overview')
  if (destinations.value.length) mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: destinations.value })
}

function suggestionLabel(suggestion: AgentSuggestion | string) {
  return typeof suggestion === 'string' ? suggestion : suggestion.label
}

function suggestionKey(suggestion: AgentSuggestion | string) {
  return typeof suggestion === 'string' ? suggestion : suggestion.id
}

function handleSuggestion(message: AgentMessage, suggestion: AgentSuggestion | string) {
  if (typeof suggestion === 'string') {
    fillAgentRequest(suggestion)
    return
  }
  if (suggestion.action === 'focus_draft_map') {
    focusDraftPreview()
    return
  }
  if (suggestion.action === 'confirm_proposal') {
    const proposalMessage = agentMessages.value.find((item) => item.proposal?.id === suggestion.proposalId) || message
    void confirmAgentProposal(proposalMessage)
    return
  }
  if (suggestion.message) {
    agentRequest.value = suggestion.message
    void sendAgentMessage()
  }
}

function isCandidateSelected(setId: string, candidateId: string, initial: string[] = []) {
  return (candidateSelections.value[setId] || initial).includes(candidateId)
}

function toggleCandidate(setId: string, candidateId: string, initial: string[] = []) {
  const selected = new Set(candidateSelections.value[setId] || initial)
  if (selected.has(candidateId)) selected.delete(candidateId)
  else selected.add(candidateId)
  candidateSelections.value = { ...candidateSelections.value, [setId]: [...selected] }
}

function confirmCandidateSelection(message: AgentMessage) {
  const candidateSet = message.candidateSet
  if (!candidateSet) return
  const selectedIds = candidateSelections.value[candidateSet.id] || candidateSet.selectedIds || []
  void sendAgentMessage({ type: 'select_candidates', candidateSetId: candidateSet.id, selectedIds }, '按这些地点继续')
}

function confirmDraftGeneration() {
  void sendAgentMessage({ type: 'confirm_generation' }, '开始生成草案')
}

async function readAgentResponse(response: Response): Promise<AgentChatResponse> {
  const body = await response.text()
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    if (body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().startsWith('<html')) {
      throw new Error('AI 服务尚未加载最新接口，请重启后端服务后再试。')
    }
    throw new Error(`AI 服务返回了无法识别的响应（${response.status}）。`)
  }
  try {
    return JSON.parse(body) as AgentChatResponse
  } catch {
    throw new Error('AI 服务返回的数据格式有误，请稍后再试。')
  }
}

async function readRunEvents(response: Response, onActivity: (activity: AgentActivity) => void): Promise<AgentChatResponse> {
  if (!response.ok || !response.body) throw new Error(`无法读取Agent运行状态（${response.status}）。`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalPayload: AgentChatResponse | null = null
  const consume = (frame: string) => {
    const eventName = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim() || ''
    const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim()
    if (!data) return
    const event = JSON.parse(data) as { payload?: AgentChatResponse | AgentActivity }
    if (eventName === 'run.activity' && event.payload) onActivity(event.payload as AgentActivity)
    if (['proposal.ready', 'run.completed'].includes(eventName)) finalPayload = event.payload as AgentChatResponse
    if (['run.failed', 'run.cancelled'].includes(eventName)) throw new Error((event.payload as AgentChatResponse)?.error || 'Agent未能完成这次请求。')
  }
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    frames.forEach(consume)
    if (done) break
  }
  if (buffer.trim()) consume(buffer)
  if (!finalPayload) throw new Error('Agent运行结束，但没有返回结果。')
  return finalPayload
}

function groupByDay(places: Destination[]) {
  const grouped = new Map<number, Destination[]>()
  for (const place of [...places].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const day = place.day || 1
    const items = grouped.get(day) || []
    items.push(place)
    grouped.set(day, items)
  }
  return Array.from(grouped.entries()).map(([day, destinations]) => ({ day, destinations })).sort((a, b) => a.day - b.day)
}

function displayOrder(place: Destination, index: number) {
  return place.withinDayOrder ?? place.order ?? index + 1
}

function isUnscheduled(place: Destination) {
  return place.planningStatus === 'unscheduled' || place.planningStatus === 'candidate'
}

function handleDayAssignment(place: Destination, event: Event) {
  const select = event.target as HTMLSelectElement
  const value = select.value
  select.value = ''
  if (value === 'new') assignDestinationToNewDay(place)
  else if (value === 'pending') moveDestinationToPending(place)
  else if (value) assignDestinationToDay(place, Number(value))
}

function assignDestinationToDay(place: Destination, day: number) {
  tripStore.moveDestinationToDay(place.id, day)
  expandedPendingId.value = null
  syncTripDates()
  bumpPlanRevision()
  selectDay('overview')
  ElMessage.success(`${place.name} 已加入 Day ${day}`)
}

function assignDestinationToNewDay(place: Destination) {
  const nextDay = Math.min(14, Math.max(routeDayCount.value + 1, 1))
  assignDestinationToDay(place, nextDay)
}

function moveDestinationToPending(place: Destination) {
  tripStore.moveDestinationToUnscheduled(place.id)
  bumpPlanRevision()
  selectDay('overview')
  ElMessage.success(`${place.name} 已移回待规划`)
}

function selectDay(day: number | 'overview' | 'unscheduled') {
  activeDay.value = day
  selectedPlaceId.value = null
  mapRef.value?.setSelectedDestination(null)
  mapRef.value?.setVisibleDay(day)
  void nextTick(() => mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: visibleDestinations.value }))
}

function mapViewportPadding() {
  if (window.innerWidth <= 900) {
    const bottom = mobileSheet.value === 'collapsed'
      ? 112
      : mobileSheet.value === 'half'
        ? Math.round(window.innerHeight * .46)
        : Math.round(window.innerHeight * .78)
    return { top: 128, right: 28, bottom, left: 28 }
  }
  const left = leftPanelRef.value?.getBoundingClientRect().right || 44
  const right = rightPanelRef.value ? window.innerWidth - rightPanelRef.value.getBoundingClientRect().left : 44
  return { top: 84, right: Math.max(44, Math.round(right + 20)), bottom: 44, left: Math.max(44, Math.round(left + 20)) }
}

function focusDestination(place: Destination, fly = true) {
  selectedPlaceId.value = place.id
  mapRef.value?.setSelectedDestination(place.id)
  if (place.day) {
    activeDay.value = place.day
    mapRef.value?.setVisibleDay(place.day)
  }
  revealMap()
  if (fly) void nextTick(() => mapRef.value?.flyToLocation(place.coordinates[0], place.coordinates[1], { zoom: 14 }))
}

function openReservationPlace(place: Destination) {
  reservationListOpen.value = false
  focusDestination(place)
  editDestination(place)
}

function startPlaceSwipe(event: TouchEvent, id: string) {
  const touch = event.touches[0]
  if (touch) placeSwipeStart = { id, x: touch.clientX, y: touch.clientY }
}

function endPlaceSwipe(event: TouchEvent, id: string) {
  const touch = event.changedTouches[0]
  const start = placeSwipeStart
  placeSwipeStart = null
  if (!touch || !start || start.id !== id) return
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  if (Math.abs(dx) < 48 || Math.abs(dy) > 32) return
  swipedPlaceId.value = dx < 0 ? id : null
  suppressPlaceClickUntil = Date.now() + 500
  event.preventDefault()
}

function handlePlaceClick(place: Destination) {
  if (Date.now() < suppressPlaceClickUntil) return
  swipedPlaceId.value = null
  focusDestination(place)
}

function canMoveDestination(id: string, direction: 'up' | 'down') {
  const current = destinations.value.find((place) => place.id === id)
  if (!current) return false
  const peers = current.planningStatus === 'unscheduled' || current.planningStatus === 'candidate'
    ? unscheduledDestinations.value
    : destinations.value
      .filter((place) => Number(place.day || 1) === Number(current.day || 1) && place.planningStatus !== 'unscheduled' && place.planningStatus !== 'candidate')
      .sort((a, b) => (a.withinDayOrder ?? a.order ?? 0) - (b.withinDayOrder ?? b.order ?? 0))
  const index = peers.findIndex((place) => place.id === id)
  return direction === 'up' ? index > 0 : index >= 0 && index < peers.length - 1
}

function moveDestination(id: string, direction: 'up' | 'down') {
  const current = destinations.value.find((place) => place.id === id)
  if (!current) return
  if (current.planningStatus !== 'unscheduled' && current.planningStatus !== 'candidate') {
    tripStore.reorderDestinationWithinDay(id, direction)
    tripStore.refreshCurrentRoute()
    bumpPlanRevision()
    void nextTick(() => mapRef.value?.updateMap())
    return
  }
  const updated = [...destinations.value]
  const index = updated.findIndex((place) => place.id === id)
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= updated.length) return
  ;[updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]]
  updated.forEach((place, position) => { place.order = position + 1 })
  tripStore.updateDestinationOrder(updated)
  tripStore.refreshCurrentRoute()
  bumpPlanRevision()
}

function removeDestination(id: string) {
  tripStore.removeDestination(id)
  tripStore.destinations.forEach((place, index) => { place.order = index + 1 })
  tripStore.refreshCurrentRoute()
  bumpPlanRevision()
  mapRef.value?.updateMap()
}

function editDestination(place: Destination) {
  mapRef.value?.openPointForm(place.coordinates, {
    id: place.id,
    name: place.name,
    description: place.description,
    image: place.image,
    coordinates: place.coordinates,
    day: place.day,
    planningStatus: place.planningStatus,
    reservationStatus: place.reservationStatus,
    reservationNote: place.reservationNote,
    placeCategory: place.placeCategory,
    order: place.withinDayOrder
  }, (data: Partial<Destination> & { assignment?: string }) => {
    tripStore.updateDestination(place.id, {
      name: data.name,
      description: data.description,
      image: data.image,
      reservationStatus: data.reservationStatus,
      reservationNote: data.reservationNote,
      placeCategory: data.placeCategory || undefined
    })
    if (data.assignment === 'unscheduled' && !isUnscheduled(place)) {
      tripStore.moveDestinationToUnscheduled(place.id)
    }
    else if (data.assignment && data.assignment !== 'unscheduled' && (isUnscheduled(place) || Number(data.assignment) !== Number(place.day || 1))) {
      tripStore.moveDestinationToDay(place.id, Number(data.assignment))
    }
    syncTripDates()
    bumpPlanRevision()
    mapRef.value?.updateMap(true)
  })
}

function loadPresetRoute() {
  tripStore.loadPresetRoute('beijing-two-day')
  activeDay.value = 'overview'
  mapRef.value?.setVisibleDay('overview')
  bumpPlanRevision()
  mapRef.value?.updateMap(false)
}

function clearRoute() {
  ElMessageBox.confirm('确定要清空所有目的地吗？', '提示', { type: 'warning' })
    .then(() => {
      tripStore.clearPlanningState()
      bumpPlanRevision()
      mapRef.value?.updateMap()
    })
    .catch(() => undefined)
}

async function saveRoute() {
  saveFeedback.value = false
  if (!destinations.value.length) return false
  const previousTripId = activeTripId.value
  const firstSave = !tripStore.savedRoutes.some((route) => route.id === previousTripId)
  const name = firstSave
    ? await promptRouteName(currentRoute.value?.name || '我的旅行路线', '保存路线')
    : currentRoute.value?.name || '我的旅行路线'
  if (!name) return false
  const routeId = previousTripId.startsWith('draft-trip-') ? createSavedTripId() : previousTripId
  persistAgentSession()
  if (routeId !== previousTripId) {
    migrateAgentStorage(previousTripId, routeId)
    activeTripId.value = routeId
    agentSession.value.tripId = routeId
  }
  const route = tripStore.buildCurrentRoute({ id: routeId, name })
  route.estimatedDays = routeDayCount.value
  tripStore.setRoute(route)
  try {
    await tripStore.saveRouteToList(route)
  } catch {
    ElMessage.error('保存失败：当前浏览器空间不足，请减少照片后重试')
    return false
  }
  persistAgentSession()
  saveFeedback.value = true
  clearTimeout(saveFeedbackTimer)
  saveFeedbackTimer = setTimeout(() => { saveFeedback.value = false }, 1800)
  ElMessage.success('路线已保存在这个浏览器')
  return true
}

function startNewRoute() {
  switchAgentSession(createDraftTripId())
  tripStore.clearPlanningState({ markDirty: false })
  tripStore.markRouteSaved()
  if (window.innerWidth <= 900) mobileSheet.value = 'collapsed'
  selectedPlaceId.value = null
  reservationListOpen.value = false
  mapRef.value?.setSelectedDestination(null)
  activeDay.value = 'overview'
  mapRef.value?.setVisibleDay('overview', false)
  mapRef.value?.updateMap()
}

async function requestNewRoute() {
  const hasRouteContent = Boolean(currentRoute.value || tripStore.currentTrip || destinations.value.length)
  if (!hasRouteContent || !tripStore.isRouteDirty) {
    startNewRoute()
    return
  }
  if (!destinations.value.length) {
    try {
      await ElMessageBox.confirm('当前路线有未保存变更，但没有可保存的地点。要放弃这些变更并新建吗？', '新建路线', {
        confirmButtonText: '放弃并新建', cancelButtonText: '继续编辑', type: 'warning'
      })
      startNewRoute()
    } catch {
      // Keep editing the current route.
    }
    return
  }
  try {
    await ElMessageBox.confirm('当前路线有未保存变更。', '新建路线', {
      confirmButtonText: '保存并新建', cancelButtonText: '放弃并新建',
      distinguishCancelAndClose: true, type: 'warning'
    })
    if (await saveRoute()) startNewRoute()
  } catch (action) {
    if (action === 'cancel') startNewRoute()
  }
}

function toggleAddPointMode() {
  isAddingPoint.value = !isAddingPoint.value
  mapRef.value?.setMapSelecting(isAddingPoint.value)
  if (!isAddingPoint.value) return
  mapRef.value?.onMapClick((coordinates: [number, number]) => {
    mapRef.value?.openPointForm(coordinates, {}, (data: Partial<Destination>) => {
      const day = typeof activeDay.value === 'number' ? activeDay.value : undefined
      const destination: Destination = {
        id: `user-${Date.now()}`,
        name: data.name || '未命名地点',
        description: data.description || '',
        coordinates,
        order: destinations.value.length + 1,
        day,
        planningStatus: day ? 'scheduled' : 'unscheduled',
        source: 'user',
        image: data.image,
        reservationStatus: data.reservationStatus,
        reservationNote: data.reservationNote,
        placeCategory: data.placeCategory || undefined
      }
      tripStore.addDestination(destination)
      if (day) syncTripDates()
      isAddingPoint.value = false
      mapRef.value?.setMapSelecting(false)
      handlePOISelect(destination)
    })
  })
}

function panMode() {
  isAddingPoint.value = false
  mapRef.value?.setMapSelecting(false)
  mapRef.value?.setPanMode(true)
}

function zoomIn() { mapRef.value?.zoomIn() }
function zoomOut() { mapRef.value?.zoomOut() }
function fitBounds() { mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: visibleDestinations.value }) }

function retryMapRender() {
  mapRenderError.value = false
  mapRef.value?.updateMap(false)
}

async function sendAgentMessage(interaction?: AgentInteraction, interactionLabel = '') {
  const content = interactionLabel || agentRequest.value.trim()
  if (!content) return
  if (!AGENT_CHAT_AVAILABLE) {
    unavailableQuestion.value = content
    agentRequest.value = ''
    void nextTick(scrollAgentToBottom)
    return
  }
  const previousMessageIds = activeRequestId.value ? activeInstructionMessageIds : []
  if (activeRequestId.value) {
    activeRequestController?.abort()
    if (activeAssistantMessage) {
      activeAssistantMessage.status = 'superseded'
      activeAssistantMessage.content = '收到你的新要求，已停止上一轮处理，并按最新内容重新调整。'
      activeAssistantMessage.activities = activeAssistantMessage.activities?.map((activity) =>
        activity.status === 'running' ? { ...activity, status: 'superseded' } : activity
      )
    }
  }
  const userMessage: AgentMessage = {
    id: `message-${Date.now()}-user`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
    status: 'complete'
  }
  addAgentMessage(userMessage)
  const instructionMessageIds = [...previousMessageIds, userMessage.id]
  const requestId = `request-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const basePlanRevision = agentSession.value.planRevision
  const controller = new AbortController()
  const assistantMessage: AgentMessage = {
    id: `message-${Date.now()}-assistant`,
    role: 'assistant',
    content: '我先读一下你的安排，看看从哪里接着整理 🧭',
    createdAt: new Date().toISOString(),
    status: 'sending',
    activities: []
  }
  addAgentMessage(assistantMessage)
  agentRequest.value = ''
  activeRequestId.value = requestId
  activeRequestController = controller
  activeInstructionMessageIds = instructionMessageIds
  activeAssistantMessage = assistantMessage
  persistAgentSession()
  try {
    const currentPlan = destinations.value.length
      ? { route: tripStore.buildCurrentRoute(), schedule: tripStore.schedule, warnings: [] }
      : null
    const recentMessages = agentMessages.value
      .filter((message) => !instructionMessageIds.includes(message.id) && message.id !== assistantMessage.id && message.status === 'complete')
      .slice(-12)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }))
    const createResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal,
      body: JSON.stringify({
        sessionId: agentSession.value.id,
        requestId,
        interaction,
        tripId: activeTripId.value,
        trip: tripStore.currentTrip || agentSession.value.draftTrip || undefined,
        message: content,
        pendingTask: agentSession.value.pendingTask,
        planRevision: basePlanRevision,
        recentMessages,
        constraints: tripConstraints,
        currentPlan,
        destinations: destinations.value
      })
    })
    const created = await readAgentResponse(createResponse) as unknown as { runId?: string; error?: string }
    if (!createResponse.ok || !created.runId) throw new Error(created.error || '无法创建Agent任务。')
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/runs/${created.runId}/events`, { credentials: 'include', signal: controller.signal })
    const payload = await readRunEvents(response, (activity) => {
      if (activeRequestId.value === requestId) upsertActivity(assistantMessage, activity)
    })
    if (activeRequestId.value !== requestId) return
    if (!response.ok) throw new Error(payload.error || '暂时无法处理这次调整')
    assistantMessage.status = 'complete'
    assistantMessage.content = payload.reply
    assistantMessage.changes = payload.changes
    assistantMessage.suggestions = payload.suggestions?.slice(0, 3)
    assistantMessage.proposal = payload.proposal
    assistantMessage.draftPlan = payload.draftPlan
    assistantMessage.draftTrip = payload.draftTrip
    assistantMessage.draftExplanation = payload.draftExplanation
    assistantMessage.candidateSet = payload.candidateSet
    assistantMessage.generationConfirmation = payload.generationConfirmation
    agentSession.value.pendingTask = payload.pendingTask || null
    if (payload.draftPlan) {
      agentSession.value.draftPlan = payload.draftPlan
      mapRef.value?.setDraftDestinations(payload.draftPlan.route.destinations)
      focusDraftPreview()
    }
    if (payload.draftTrip) agentSession.value.draftTrip = payload.draftTrip
    if (payload.constraints) Object.assign(tripConstraints, payload.constraints)
    payload.warnings?.forEach((warning, index) => addAgentMessage({
      id: `message-${Date.now()}-warning-${index}`,
      role: 'system',
      content: warning.startsWith('⚠️') ? warning : `⚠️ ${warning}`,
      createdAt: new Date().toISOString(),
      status: 'complete'
    }))
    persistAgentSession()
  } catch (error) {
    if (controller.signal.aborted || activeRequestId.value !== requestId) return
    const message = error instanceof Error ? error.message : '暂时无法处理这次调整'
    assistantMessage.role = 'system'
    assistantMessage.status = 'failed'
    assistantMessage.content = message
    assistantMessage.activities = assistantMessage.activities?.map((activity) => activity.status === 'running' ? { ...activity, status: 'failed' } : activity)
    ElMessage.error(message)
  } finally {
    if (activeRequestId.value === requestId) {
      activeRequestId.value = null
      activeRequestController = null
      activeInstructionMessageIds = []
      activeAssistantMessage = null
      persistAgentSession()
    }
  }
}

async function confirmAgentProposal(message: AgentMessage) {
  if (!message.proposal || message.proposal.status !== 'pending') return
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/proposals/${message.proposal.id}/confirm`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: agentSession.value.planRevision })
    })
    const payload = await readAgentResponse(response) as AgentChatResponse & { status?: string }
    if (!response.ok || (!payload.plan && !(payload as AgentChatResponse & { trip?: unknown }).trip)) throw new Error(payload.error || '无法应用这份修改。')
    undoSnapshot.value = tripStore.createTripSnapshot()
    localStorage.setItem(agentUndoKey(activeTripId.value), JSON.stringify(undoSnapshot.value))
    if (payload.plan) {
      tripStore.applyAgentPlan({ ...payload.plan, route: { ...payload.plan.route, id: activeTripId.value } })
      bumpPlanRevision()
    }
    if (payload.trip) {
      tripStore.applyTripOutline(payload.trip)
      agentSession.value.planRevision = payload.trip.revision || agentSession.value.planRevision + 1
    }
    agentSession.value.draftPlan = null
    agentSession.value.draftTrip = null
    mapRef.value?.setDraftDestinations([])
    mapRef.value?.setDraftPreviewMode(false)
    previewingDraft.value = false
    message.proposal.status = 'applied'
    addAgentMessage({ id: `message-${Date.now()}-applied`, role: 'system', content: '已确认并同步更新地图与日程。', createdAt: new Date().toISOString(), status: 'complete' })
    persistAgentSession()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法应用这份修改。')
  }
}

async function rejectAgentProposal(message: AgentMessage) {
  if (!message.proposal || message.proposal.status !== 'pending') return
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/proposals/${message.proposal.id}/reject`, { method: 'POST', credentials: 'include' })
    if (!response.ok) throw new Error('无法拒绝这份修改。')
    message.proposal.status = 'rejected'
    persistAgentSession()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法拒绝这份修改。')
  }
}

function undoLastAgentChange() {
  if (!undoSnapshot.value) return
  tripStore.restoreTripSnapshot(undoSnapshot.value)
  bumpPlanRevision()
  undoSnapshot.value = null
  localStorage.removeItem(agentUndoKey(activeTripId.value))
  mapRef.value?.updateMap()
  addAgentMessage({
    id: `message-${Date.now()}-undo`,
    role: 'system',
    content: '已撤销最近一次 AI 行程调整。',
    createdAt: new Date().toISOString(),
    status: 'complete'
  })
  ElMessage.success('已撤销最近一次调整')
}

function handlePOISelect(place: Destination) {
  bumpPlanRevision()
  const target = isUnscheduled(place) ? 'unscheduled' : Number(place.day || 1)
  activeDay.value = target
  mapRef.value?.setVisibleDay(target)
  focusDestination(place)
  if (window.innerWidth <= 900) mobileSheet.value = 'half'
  ElMessage.success(isUnscheduled(place) ? `已加入待规划：${place.name}` : `已加入 Day ${place.day}：${place.name}`)
}

function previewSearchPOI(poi: POIPreview) {
  poiPreviewRequest += 1
  poiPreviewLoading.value = false
  poiPreviewError.value = ''
  showPoiPlacement.value = false
  poiPlacementOverride.value = null
  poiPreview.value = { ...poi, coordinates: [poi.coordinates[0], poi.coordinates[1]] }
  mapRef.value?.flyToLocation(poi.coordinates[0], poi.coordinates[1], { zoom: 16 })
}

async function previewMapPOI(poi: { id: string; name: string; coordinates: [number, number] }) {
  const request = ++poiPreviewRequest
  poiPreview.value = {
    id: poi.id,
    name: poi.name,
    city: '',
    district: '',
    address: '',
    coordinates: [poi.coordinates[0], poi.coordinates[1]],
    sourceLabel: '高德'
  }
  poiPreviewLoading.value = true
  poiPreviewError.value = ''
  showPoiPlacement.value = false
  poiPlacementOverride.value = null
  try {
    const response = await fetch(`${apiBaseUrl}/poi/detail?${new URLSearchParams({ id: poi.id })}`)
    const data = await response.json().catch(() => ({})) as { poi?: POIPreview; error?: string }
    if (!response.ok || !data.poi) throw new Error(data.error || '地点详情暂时不可用。')
    if (request === poiPreviewRequest) poiPreview.value = data.poi
  } catch (error) {
    if (request === poiPreviewRequest) {
      poiPreviewError.value = error instanceof Error ? error.message : '地点详情暂时不可用。'
    }
  } finally {
    if (request === poiPreviewRequest) poiPreviewLoading.value = false
  }
}

function closePOIPreview() {
  poiPreviewRequest += 1
  poiPreview.value = null
  poiPreviewLoading.value = false
  poiPreviewError.value = ''
  showPoiPlacement.value = false
  poiPlacementOverride.value = null
}

function addPreviewedPOI() {
  const poi = poiPreview.value
  if (!poi) return
  const exists = destinations.value.some((item) => item.name === poi.name
    && Math.abs(item.coordinates[0] - poi.coordinates[0]) < 0.00001
    && Math.abs(item.coordinates[1] - poi.coordinates[1]) < 0.00001)
  if (exists) {
    ElMessage.info('这个地点已经在行程里了')
    return
  }
  const targetDay = effectivePoiPlacement.value === 'unscheduled' ? undefined : effectivePoiPlacement.value
  const destination: Destination = {
    id: `user-${Date.now()}`,
    name: poi.name,
    description: [poi.district || poi.city, poi.address].filter(Boolean).join(' · '),
    coordinates: [poi.coordinates[0], poi.coordinates[1]],
    order: destinations.value.length + 1,
    day: targetDay,
    planningStatus: targetDay ? 'scheduled' : 'unscheduled',
    source: 'user'
  }
  tripStore.addDestination(destination)
  if (targetDay) syncTripDates()
  closePOIPreview()
  handlePOISelect(destination)
}

watch(showRouteLine, (visible) => {
  mapRef.value?.setRouteLineVisible(visible)
}, { immediate: true })

watch(reservationDueCount, (count) => {
  if (!count) reservationListOpen.value = false
})

watch(dayOptions, (days) => {
  const actualDayCount = Math.max(days.length, 1)
  if (tripConstraints.days !== actualDayCount) tripConstraints.days = actualDayCount
  if (currentRoute.value && currentRoute.value.estimatedDays !== actualDayCount) currentRoute.value.estimatedDays = actualDayCount
  if (typeof activeDay.value === 'number' && !days.includes(activeDay.value)) activeDay.value = 'overview'
}, { immediate: true })

watch(() => currentRoute.value?.id, (routeId) => {
  if (routeId && routeId !== activeTripId.value) switchAgentSession(routeId)
})

onMounted(() => {
  Object.assign(tripConstraints, agentSession.value.constraints)
  if (currentRoute.value) tripConstraints.startDate = tripStore.tripStartDate
  startDateInput.value = tripConstraints.startDate || ''
  if (window.innerWidth <= 900 && !destinations.value.length) mobileSheet.value = 'collapsed'
  void nextTick(scrollAgentToBottom)
  nextTick(() => {
    mapRef.value?.setDraftDestinations(agentSession.value.draftPlan?.route.destinations || [])
    mapRef.value?.setDraftPreviewMode(previewingDraft.value)
    mapRef.value?.onViewChange((center: [number, number]) => { mapCenter.value = center })
    mapRef.value?.onRenderError((error: Error) => {
      mapRenderError.value = true
      addAgentMessage({
        id: `message-${Date.now()}-map-warning`,
        role: 'system',
        content: `⚠️ 行程已经保存，但地图暂时没有刷新。你可以点击“重试地图”。`,
        createdAt: new Date().toISOString(),
        status: 'complete'
      })
      console.warn('Map render failed after retry:', error)
    })
    mapRef.value?.onFeatureClick((feature) => {
      const place = destinations.value.find((item) => item.id === feature.id)
      if (place) {
        selectedPlaceId.value = place.id
        editDestination(place)
      }
    })
    mapRef.value?.onPoiClick((poi) => { void previewMapPOI(poi) })
    mapRef.value?.onReady(() => {
      const editId = typeof route.query.edit === 'string' ? route.query.edit : ''
      const focusId = editId || (typeof route.query.focus === 'string' ? route.query.focus : '')
      const place = destinations.value.find((item) => item.id === focusId)
      if (place && editId) {
        selectedPlaceId.value = place.id
        mapRef.value?.setSelectedDestination(place.id)
        activeDay.value = place.day || 'overview'
        mapRef.value?.setVisibleDay(activeDay.value)
        mapRef.value?.flyToLocation(place.coordinates[0], place.coordinates[1], { zoom: 14, speed: 0 })
        editDestination(place)
      } else if (place) focusDestination(place)
    })
  })
})

watch(tripConstraints, persistAgentSession, { deep: true })

onBeforeUnmount(() => {
  clearTimeout(saveFeedbackTimer)
  if (activeAssistantMessage?.status === 'sending') {
    activeAssistantMessage.status = 'superseded'
    activeAssistantMessage.content = '已离开当前路线，本次处理已停止。'
    activeAssistantMessage.activities = activeAssistantMessage.activities?.map((activity) =>
      activity.status === 'running' ? { ...activity, status: 'superseded' } : activity
    )
    persistAgentSession()
  }
  activeRequestController?.abort()
})
</script>

<style scoped>
.map-view { --cross-ink-soft: rgba(32, 37, 41, .76); --cross-ink-faint: rgba(32, 37, 41, .38); --cross-muted: #555f64; position: relative; width: 100%; height: 100%; min-height: 0; background: #d8dcdd; overflow: hidden; }
.workspace { position: relative; height: 100%; min-height: 0; }
.mobile-sheet-handle, .mobile-companion-launcher, .mobile-sheet-summary { display: none; }
.paper-panel { background: rgba(216, 220, 221, .94); border: 1px solid rgba(29, 34, 38, .18); border-radius: 8px; box-shadow: 0 6px 20px rgba(29, 34, 38, .1); }
.trip-panel, .agent-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.panel-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 18px 16px 14px; border-bottom: 1px solid rgba(29, 34, 38, .14); }
.panel-title h1, .panel-title h2 { margin: 2px 0 4px; color: #1d2226; font-size: 20px; line-height: 1.2; font-weight: 650; }
.panel-title span, .eyebrow { color: rgba(29, 34, 38, .76); font-size: 12px; }
.eyebrow { margin: 0; letter-spacing: 0; text-transform: uppercase; }
.icon-button { width: 26px; height: 26px; border: 0; color: #6b6c7b; background: transparent; font-size: 23px; cursor: pointer; }
.icon-button:hover { color: var(--cross-rust); }
.collapsed-rail { display: flex; flex: 1; align-items: flex-start; justify-content: center; padding-top: 16px; }
.rail-button { writing-mode: vertical-rl; border: 0; background: transparent; color: #5b6f60; font: inherit; font-size: 12px; cursor: pointer; }
.day-tabs { display: flex; gap: 4px; padding: 10px 12px; overflow-x: auto; border-bottom: 1px solid #eee4d7; }
.day-tabs button { flex: 0 0 auto; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #776e63; padding: 7px 5px; font: inherit; font-size: 12px; cursor: pointer; }
.day-tabs button.active { color: var(--cross-rust); border-bottom-color: var(--cross-rust); font-weight: 650; }
.trip-scroll, .agent-scroll { min-height: 0; overflow-y: auto; }
.trip-scroll { flex: 1; padding: 12px; }
.draft-notice { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding: 8px 10px; border: 1px dashed #b6a18a; background: #eee7dc; color: #6b6c7b; font-size: 12px; }
.draft-notice small { color: #6b6c7b; }
.day-heading { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 2px 9px; color: #455a49; font-weight: 650; font-size: 14px; }
.day-heading small { color: #6f6559; font-size: 11px; font-weight: 400; }
.place-list { display: flex; flex-direction: column; gap: 2px; }
.place-row { display: flex; align-items: flex-start; gap: 9px; padding: 10px 4px; border-bottom: 1px solid #f0e9df; cursor: pointer; }
.place-row:hover, .place-row.selected { background: #f7f0e4; }
.place-row.draft { background: #eee7dc; }
.place-marker { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; flex: 0 0 auto; border-radius: 50%; background: #5b6b73; color: #dcdfde; font-size: 11px; font-weight: 700; }
.place-marker.muted { background: #d4dfd0; color: #5f7267; }
.place-copy { min-width: 0; flex: 1; }
.place-copy strong, .place-copy small { display: block; }
.place-copy strong { overflow: hidden; color: #293b30; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.place-copy small { margin-top: 3px; color: #625d56; font-size: 11px; }
.empty-copy { padding: 28px 8px; color: #69635b; font-size: 13px; text-align: center; }
.text-action { border: 0; background: transparent; color: var(--cross-rust); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.map-stage { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
.map-canvas { width: 100%; height: 100%; }
.draft-map-banner { position: absolute; top: 74px; left: 400px; z-index: 11; display: flex; max-width: min(420px, calc(100% - 800px)); align-items: center; gap: 14px; border-left: 3px solid var(--cross-rust); background: rgba(216, 220, 221, .94); padding: 8px 10px; box-shadow: 0 2px 10px rgba(32, 37, 41, .1); }
.draft-map-banner strong, .draft-map-banner span { display: block; }
.draft-map-banner strong { color: var(--cross-ink); font-size: 12px; }
.draft-map-banner span { margin-top: 2px; color: var(--cross-ink-soft); font-size: 11px; }
.draft-map-banner button { border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink-soft); padding: 3px 0; font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.draft-map-banner button:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.map-toolbar { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 10; display: flex; align-items: center; gap: 7px; padding: 7px; }
.map-toolbar :deep(.poi-search) { width: min(360px, 42%); }
.poi-preview-card { position: absolute; top: 84px; left: 50%; z-index: 9; width: min(340px, calc(100% - 48px)); transform: translateX(-50%); border: 1px solid var(--cross-ink-faint); border-radius: 4px 18px 4px 4px; background: rgba(216, 220, 221, .96); padding: 16px 18px 14px; color: var(--cross-ink); }
.poi-preview-card strong, .poi-preview-card p, .poi-preview-card small { display: block; }
.poi-preview-card strong { margin-top: 3px; font-size: 16px; }
.poi-preview-card p { margin: 7px 24px 0 0; color: var(--cross-ink-soft); font-size: 13px; line-height: 1.6; }
.poi-preview-card small { margin-top: 6px; color: var(--cross-rust); line-height: 1.5; }
.poi-preview-source { color: var(--cross-ink-soft); font-size: 11px; }
.poi-preview-close { position: absolute; top: 8px; right: 10px; width: 32px; height: 32px; border: 0; background: transparent; color: var(--cross-ink-soft); font: inherit; font-size: 20px; cursor: pointer; }
.poi-preview-actions { display: flex; justify-content: flex-end; align-items: center; gap: 16px; margin-top: 14px; }
.poi-placement-toggle { margin-top: 10px; border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink-soft); padding: 3px 0; font: inherit; font-size: 11px; cursor: pointer; }
.poi-placement-toggle:hover, .poi-placement-toggle:focus-visible { border-bottom-color: #5d7fa3; color: var(--cross-ink); outline: none; }
.poi-placement-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.poi-placement-options button { min-height: 34px; border: 1px solid rgba(93, 127, 163, .35); border-radius: 11px 4px 9px 5px; background: transparent; color: var(--cross-ink-soft); padding: 5px 9px; font: inherit; font-size: 11px; cursor: pointer; }
.poi-placement-options button.active { border-color: #5d7fa3; background: rgba(93, 127, 163, .1); color: var(--cross-ink); }
.poi-add-action { min-height: 38px; border: 1px solid var(--cross-ink-faint); border-radius: 3px 10px 3px 3px; background: transparent; color: var(--cross-ink); padding: 7px 12px; font: inherit; cursor: pointer; }
.poi-add-action:hover, .poi-add-action:focus-visible { border-color: var(--cross-rust); color: var(--cross-rust); outline: none; }
.poi-add-action:disabled { cursor: wait; opacity: .55; }
.toolbar-divider { width: 1px; height: 22px; background: rgba(29, 34, 38, .16); }
.toolbar-button { border: 0; background: transparent; color: #5b6b73; padding: 7px 8px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.toolbar-button:hover, .toolbar-button.active { background: #e4ebef; color: #1d2226; }
.toolbar-button:disabled { color: rgba(29, 34, 38, .32); cursor: not-allowed; }
.map-key { position: absolute; left: 12px; bottom: 12px; z-index: 10; display: flex; align-items: center; gap: 7px; padding: 7px 10px; color: #5b6b73; font-size: 11px; }
.key-line { width: 20px; height: 0; border-top: 2px dashed #5b6b73; opacity: .6; }
.draft-line { border-top-style: dashed; }
.agent-panel { position: absolute; top: 20px; right: 20px; bottom: 20px; z-index: 3; width: 360px; }
.workspace.right-collapsed .agent-panel { width: 46px; }
.agent-title { align-items: center; justify-content: flex-start; padding: 12px 14px 10px; }
.agent-companion { width: 42px; height: 42px; flex: 0 0 auto; }
.agent-heading-copy { min-width: 0; flex: 1; }
.agent-heading-copy h2 { margin: 0; }
.agent-status { margin: 3px 0 0; color: var(--cross-ink-soft); font-size: 11px; }
.trip-brief { position: relative; display: grid; grid-template-columns: auto repeat(3, minmax(0, 1fr)); gap: 6px 8px; align-items: center; padding: 7px 12px 8px; border-bottom: 1px solid rgba(29, 34, 38, .14); }
.brief-label { color: var(--cross-ink-soft); font-size: 11px; white-space: nowrap; }
.brief-item { position: relative; min-width: 0; }
.trip-brief.editing .brief-item:not(.active) { display: none; }
.brief-item.active { grid-column: 1 / -1; padding-left: 8px; }
.brief-item.active::before { position: absolute; top: 3px; bottom: 4px; left: 0; width: 2px; background: var(--cross-rust); content: ''; }
.brief-row { display: grid; width: 100%; grid-template-columns: auto minmax(0, 1fr) 9px; gap: 5px; align-items: center; border: 0; border-bottom: 1px solid transparent; background: transparent; color: var(--cross-ink); padding: 3px 0 4px; font: inherit; text-align: left; cursor: pointer; }
.brief-row > span { color: var(--cross-ink-soft); font-size: 11px; white-space: nowrap; }
.brief-row > strong { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.brief-row > i { color: var(--cross-ink-faint); font-style: normal; font-size: 14px; line-height: 1; transition: transform .18s ease; }
.brief-row:hover, .brief-row:focus-visible { border-bottom-color: var(--cross-ink-faint); outline: none; }
.brief-item.active .brief-row > i { color: var(--cross-rust); transform: rotate(90deg); }
.brief-editor { padding: 6px 2px 8px 56px; color: var(--cross-ink); }
.brief-editor > label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
.destination-editor > input { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid var(--cross-ink-faint); border-radius: 0; outline: none; background: transparent; color: var(--cross-ink); padding: 7px 1px; font: inherit; font-size: 12px; }
.destination-editor > input:focus { border-bottom-color: var(--cross-rust); }
.destination-group { margin-top: 12px; }
.destination-group > small { display: block; margin-bottom: 3px; color: var(--cross-ink-soft); font-size: 10px; }
.destination-group > button { display: grid; width: 100%; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 4px; align-items: center; border: 0; border-bottom: 1px solid rgba(32, 37, 41, .09); background: transparent; color: var(--cross-ink); padding: 7px 0; font: inherit; text-align: left; cursor: pointer; }
.destination-group > button:hover strong { color: var(--cross-rust); }
.destination-group > button span { color: var(--cross-moss); }
.destination-group > button strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.destination-group > button em { color: var(--cross-ink-soft); font-size: 10px; font-style: normal; }
.use-query, .defer-action { margin-top: 9px; border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink-soft); padding: 3px 0; font: inherit; font-size: 11px; cursor: pointer; }
.use-query:hover, .defer-action:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.date-editor :deep(.el-date-editor) { width: 100%; box-sizing: border-box; background: rgba(197, 203, 204, .42); box-shadow: inset 0 0 0 1px rgba(32, 37, 41, .14); }
.date-editor > input[type='number'] { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink); padding: 8px 1px; font: inherit; }
.date-editor > small { display: block; margin-top: 7px; color: var(--cross-ink-soft); font-size: 10px; }
.pace-editor { display: grid; gap: 5px; }
.pace-editor > label { margin-bottom: 3px; }
.pace-editor > button { border: 1px solid rgba(32, 37, 41, .14); border-radius: 3px 9px 3px 3px; background: transparent; color: var(--cross-ink); padding: 8px 9px; font: inherit; text-align: left; cursor: pointer; }
.pace-editor > button strong, .pace-editor > button span { display: block; }
.pace-editor > button strong { font-size: 12px; }
.pace-editor > button span { margin-top: 3px; color: var(--cross-ink-soft); font-size: 10px; line-height: 1.45; }
.pace-editor > button:hover, .pace-editor > button.selected { border-color: var(--cross-rust); }
.pace-editor > button.selected strong { color: var(--cross-rust); }
.agent-scroll { flex: 1; padding: 14px 14px 8px; }
.agent-state, .agent-result { color: #5b6b73; font-size: 13px; line-height: 1.55; }
.proposal-card { margin-top: 10px; padding: 10px; border: 1px solid rgba(142, 67, 43, .28); border-radius: 6px; background: rgba(250, 247, 240, .62); }
.proposal-card p { margin: 6px 0; }
.proposal-actions { display: flex; gap: 8px; align-items: center; }
.proposal-segments { display: grid; gap: 4px; margin: 8px 0; padding-left: 20px; }
.proposal-segments li { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; }
.proposal-segments small { grid-column: 1 / -1; color: var(--cross-ink-soft); }
.draft-result-card { margin-top: 10px; border-top: 2px solid var(--cross-rust); border-bottom: 1px solid rgba(32, 37, 41, .18); background: rgba(216, 220, 221, .42); padding: 11px 0; }
.candidate-result, .generation-confirmation { margin-top: 10px; border-top: 2px solid var(--cross-moss); border-bottom: 1px solid rgba(32, 37, 41, .18); padding: 10px 0; }
.candidate-result > header strong, .candidate-result > header small { display: block; }
.candidate-result > header strong, .generation-confirmation > strong { color: var(--cross-ink); font-size: 13px; }
.candidate-result > header small, .generation-confirmation > small { margin-top: 3px; color: var(--cross-ink-soft); font-size: 11px; line-height: 1.55; }
.candidate-list { margin-top: 8px; border-top: 1px solid rgba(32, 37, 41, .12); }
.candidate-row { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 7px; align-items: start; border-bottom: 1px solid rgba(32, 37, 41, .1); padding: 8px 1px; cursor: pointer; }
.candidate-row input { accent-color: var(--cross-rust); margin: 3px 0 0; }
.candidate-row span, .candidate-row strong, .candidate-row small { display: block; }
.candidate-row strong { color: var(--cross-ink); font-size: 12px; }
.candidate-row small { margin-top: 2px; color: var(--cross-ink-soft); font-size: 10px; line-height: 1.45; }
.candidate-continue { margin-top: 10px; border: 0; border-bottom: 1px solid var(--cross-rust); border-radius: 0; background: transparent; color: var(--cross-rust); padding: 4px 1px; font: inherit; font-size: 12px; cursor: pointer; }
.generation-confirmation { border-top-color: var(--cross-rust); }
.generation-confirmation p { margin: 6px 0 3px; color: var(--cross-ink); font-size: 12px; }
.generation-confirmation .confirm-action { display: block; margin-top: 10px; }
.draft-result-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.draft-result-card > header strong, .draft-result-card > header small { display: block; }
.draft-result-card > header strong { color: var(--cross-ink); font-size: 13px; }
.draft-result-card > header small { margin-top: 3px; color: var(--cross-ink-soft); font-size: 11px; }
.draft-basis, .draft-evidence { margin-top: 10px; border-top: 1px solid rgba(32, 37, 41, .12); padding-top: 8px; }
.draft-basis > strong, .draft-evidence > strong { color: var(--cross-ink); font-size: 11px; }
.draft-basis ul { margin: 5px 0 0; padding-left: 17px; color: var(--cross-ink-soft); font-size: 11px; line-height: 1.6; }
.draft-days { margin: 10px 0 0; padding: 0; list-style: none; }
.draft-days li { display: grid; grid-template-columns: 48px 1fr; gap: 3px 8px; border-top: 1px solid rgba(32, 37, 41, .1); padding: 8px 0; }
.draft-days li strong { color: var(--cross-rust); font-size: 12px; }
.draft-days li span { color: var(--cross-ink); font-size: 12px; line-height: 1.5; }
.draft-days li small { grid-column: 2; margin: 0; color: var(--cross-ink-soft); font-size: 11px; line-height: 1.5; }
.draft-evidence { display: flex; flex-wrap: wrap; gap: 5px 7px; align-items: center; }
.draft-evidence > strong { width: 100%; }
.draft-evidence span { border-left: 2px solid var(--cross-moss); color: var(--cross-ink-soft); padding-left: 5px; font-size: 10px; }
.draft-result-actions { display: flex; gap: 9px; align-items: center; margin-top: 10px; }
.confirm-action { border: 0; border-radius: 4px; padding: 6px 10px; background: var(--cross-rust); color: #fff; cursor: pointer; }
.chat-message { max-width: 92%; margin: 0 0 12px; border: 1px solid rgba(48, 56, 61, .14); border-radius: 8px; background: rgba(244, 246, 245, .74); padding: 9px 10px; color: #30383d; font-size: 13px; line-height: 1.55; }
.chat-message.user { margin-left: auto; border-color: rgba(79, 102, 86, .28); background: rgba(79, 102, 86, .14); }
.chat-message.system { max-width: 100%; border-style: dashed; background: rgba(91, 107, 115, .1); color: #5b6b73; }
.chat-message.failed { border-color: rgba(161, 75, 60, .36); background: rgba(161, 75, 60, .09); }
.chat-message.superseded { border-color: rgba(32, 37, 41, .12); background: rgba(197, 203, 204, .36); color: var(--cross-ink-soft); }
.message-content { margin-top: 5px; white-space: pre-wrap; }
.message-content :deep(p) { margin: 0 0 7px; }
.message-content :deep(p:last-child) { margin-bottom: 0; }
.message-content :deep(h1), .message-content :deep(h2), .message-content :deep(h3) { margin: 8px 0 5px; color: var(--cross-ink); font-size: 13px; }
.message-content :deep(ul), .message-content :deep(ol) { margin: 5px 0 8px; padding-left: 18px; }
.message-content :deep(li) { margin: 3px 0; }
.message-content :deep(code) { background: rgba(32, 37, 41, .08); padding: 1px 3px; font-family: inherit; font-size: .95em; }
.chat-message small { display: block; margin-top: 5px; color: rgba(48, 56, 61, .74); }
.message-meta { display: flex; min-height: 14px; align-items: center; justify-content: flex-start; gap: 8px; color: rgba(48, 56, 61, .68); font-size: 11px; }
.chat-message.user .message-meta { justify-content: flex-end; }
.message-meta time { font: inherit; }
.thinking-mark { display: inline-flex; height: 12px; align-items: center; gap: 2px; }
.thinking-mark i { display: block; width: 2px; border-radius: 2px; background: var(--cross-rust); animation: thinking-rise 1.15s ease-in-out infinite; }
.thinking-mark i:nth-child(1) { height: 4px; }
.thinking-mark i:nth-child(2) { height: 9px; animation-delay: -.82s; }
.thinking-mark i:nth-child(3) { height: 6px; animation-delay: -.56s; }
.thinking-mark i:nth-child(4) { height: 11px; animation-delay: -.28s; }
@keyframes thinking-rise { 0%, 100% { transform: scaleY(.55); opacity: .45; } 50% { transform: scaleY(1); opacity: 1; } }
.change-list { margin: 8px 0 0; border-top: 1px solid rgba(48, 56, 61, .12); padding: 7px 0 0 18px; color: #4f6656; font-size: 12px; }
.change-list li { margin: 3px 0; }
.follow-up-suggestions { display: grid; gap: 5px; margin-top: 9px; border-top: 1px solid rgba(32, 37, 41, .12); padding-top: 8px; }
.follow-up-suggestions button { border: 0; border-bottom: 1px solid rgba(32, 37, 41, .14); background: transparent; color: var(--cross-ink-soft); padding: 5px 1px; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.follow-up-suggestions button::before { margin-right: 5px; color: var(--cross-rust); content: '↗'; }
.follow-up-suggestions button:hover, .follow-up-suggestions button:focus-visible { border-bottom-color: var(--cross-rust); color: var(--cross-rust); outline: none; }
.activity-panel { margin-top: 8px; border-top: 1px solid rgba(32, 37, 41, .12); padding-top: 6px; }
.activity-heading { display: flex; width: 100%; align-items: center; justify-content: space-between; border: 0; background: transparent; color: var(--cross-ink-soft); padding: 2px 0; font: inherit; font-size: 11px; cursor: pointer; }
.activity-heading i { color: var(--cross-rust); font-style: normal; font-size: 14px; }
.activity-list { margin: 7px 0 0; padding: 0; list-style: none; }
.activity-list li { display: grid; grid-template-columns: 16px 1fr; gap: 5px; padding: 4px 0; color: var(--cross-ink-soft); }
.activity-list li.running { color: var(--cross-ink); }
.activity-list li.failed { color: var(--cross-rust); }
.activity-list li.superseded { color: var(--cross-ink-soft); opacity: .7; }
.activity-mark { color: var(--cross-moss); font-size: 10px; line-height: 1.7; }
.activity-list li.running .activity-mark { color: var(--cross-rust); animation: activity-pulse 1.2s ease-in-out infinite; }
.activity-list li.failed .activity-mark { color: var(--cross-rust); }
.activity-list li.superseded .activity-mark { color: var(--cross-ink-faint); }
.activity-list strong, .activity-list small { display: block; }
.activity-list strong { font-size: 11px; font-weight: 600; }
.activity-list small { margin-top: 1px; color: var(--cross-ink-soft); font-size: 10px; line-height: 1.45; }
@keyframes activity-pulse { 50% { opacity: .35; } }
.undo-bar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid rgba(95, 91, 112, .24); border-radius: 6px; background: rgba(229, 226, 234, .96); padding: 8px 10px; color: #5f5b70; font-size: 11px; }
.state-title { margin: 0 0 8px; color: #1d2226; font-size: 15px; font-weight: 650; }
.agent-state p { margin: 0; }
.empty-agent { padding-top: 8px; }
.empty-agent > p:not(.state-title) { max-width: 29em; color: var(--cross-ink-soft); line-height: 1.75; }
.agent-unavailable { padding: 8px 2px; }
.agent-unavailable > p { margin: 0 0 12px; color: var(--cross-ink-soft); line-height: 1.7; }
.agent-unavailable > .state-title { color: var(--cross-ink); }
.agent-unavailable ul { margin: 0 0 14px; padding: 0; color: var(--cross-ink-soft); list-style: none; }
.agent-unavailable li { position: relative; padding: 3px 0 3px 14px; }
.agent-unavailable li::before { position: absolute; top: 3px; left: 1px; color: #5d7fa3; content: '·'; }
.unavailable-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.unavailable-actions button { min-height: 38px; border: 1px solid var(--cross-ink-faint); border-radius: 4px 10px 4px 5px; background: transparent; color: var(--cross-ink); padding: 7px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.unavailable-actions button:hover, .unavailable-actions button:focus-visible { border-color: #5d7fa3; color: #365f78; outline: none; }
.unavailable-reply { max-width: 100%; border-style: solid; background: rgba(216, 220, 221, .55); }
.unavailable-reply .text-action { margin-top: 8px; }
.planning-entry-list { display: grid; margin-top: 16px; border-top: 1px solid rgba(32, 37, 41, .16); }
.planning-entry-list button { display: grid; gap: 4px; width: 100%; border: 0; border-bottom: 1px solid rgba(32, 37, 41, .16); background: transparent; color: var(--cross-ink); padding: 12px 22px 12px 2px; font: inherit; text-align: left; cursor: pointer; transition: border-color .18s ease, padding-left .18s ease; }
.planning-entry-list button::after { position: absolute; right: 3px; align-self: center; color: var(--cross-ink-faint); content: '→'; }
.planning-entry-list button { position: relative; }
.planning-entry-list button:hover, .planning-entry-list button:focus-visible, .planning-entry-list button.active { border-bottom-color: #6575AC; padding-left: 6px; outline: none; }
.planning-entry-list button.active::after { color: #6575AC; }
.planning-entry-list strong { font-size: 13px; font-weight: 650; }
.planning-entry-list span { color: var(--cross-ink-soft); font-size: 11px; line-height: 1.6; }
.quick-prompts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.quick-prompts button { border: 1px solid rgba(91, 107, 115, .28); border-radius: 3px 9px 3px 3px; background: transparent; color: #5b6b73; padding: 6px 8px; font: inherit; font-size: 11px; cursor: pointer; transition: transform .18s ease, border-color .18s ease, color .18s ease; }
.quick-prompts button:hover { transform: translateY(-1px); border-color: var(--cross-rust); color: var(--cross-rust); }
.setup-link { margin-top: 13px; border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink-soft); padding: 2px 0; font: inherit; font-size: 11px; cursor: pointer; }
.setup-link:hover, .setup-link:focus-visible { border-bottom-color: var(--cross-rust); color: var(--cross-rust); outline: none; }
.trace-list { margin: 0; padding-left: 20px; color: rgba(29, 34, 38, .76); }
.trace-list li { padding: 5px 0; }
.draft-day { padding: 9px 0; border-bottom: 1px solid rgba(29, 34, 38, .1); }
.draft-day strong, .draft-day span { display: block; }
.draft-day strong { color: #6b6c7b; font-size: 12px; }
.draft-day span { margin-top: 3px; color: #5b6b73; font-size: 13px; }
.result-summary { margin: 0 0 6px; color: rgba(29, 34, 38, .76); font-size: 12px; }
.reason-block, .warning-block { margin-top: 12px; padding: 10px; border-left: 3px solid #5f7267; background: #e5ece5; font-size: 12px; }
.warning-block { border-left-color: #a14b3c; background: #f1e6e2; }
.reason-block strong, .warning-block strong { color: #5f7267; }
.warning-block strong { color: #a14b3c; }
.reason-block p, .warning-block p { margin: 4px 0 0; }
.draft-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
.primary-action, .secondary-action, .send-button { border: 1px solid transparent; border-radius: 5px; padding: 8px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.primary-action, .send-button { background: rgba(79, 102, 86, .18); color: #30383d; border-color: rgba(79, 102, 86, .38); font-weight: 650; }
.primary-action:hover, .send-button:hover { background: rgba(79, 102, 86, .28); }
.secondary-action { border-color: rgba(91, 107, 115, .34); background: rgba(91, 107, 115, .16); color: #30383d; }
.agent-input { position: relative; display: grid; grid-template-columns: 46px minmax(0, 1fr) auto; gap: 8px; align-items: end; padding: 12px; border-top: 1px solid rgba(29, 34, 38, .14); background: rgba(216, 220, 221, .52); }
.input-companion { grid-row: 1 / 3; width: 44px; height: 44px; align-self: end; transform: translateY(-4px); }
.agent-input-suggestions { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 5px; }
.agent-input-suggestions button { border: 0; border-bottom: 1px solid rgba(32, 37, 41, .2); background: transparent; color: var(--cross-ink-soft); padding: 3px 1px; font: inherit; font-size: 10px; cursor: pointer; }
.agent-input-suggestions button:hover, .agent-input-suggestions button:focus-visible { border-bottom-color: #6575ac; color: var(--cross-ink); outline: none; }
.agent-input textarea { grid-column: 2; }
.agent-input .send-button { grid-column: 3; }
.agent-input textarea { min-width: 0; flex: 1; border: 1px solid rgba(29, 34, 38, .18); border-radius: 5px; background: #dcdfde; color: #1d2226; padding: 8px; resize: none; font: inherit; font-size: 12px; line-height: 1.45; }
.agent-input textarea::placeholder, .destination-editor > input::placeholder { color: rgba(32, 37, 41, .64); }
.agent-input textarea:focus { border-color: var(--cross-rust); outline: none; }
.send-button:disabled { background: #c7cdcf; border-color: #c7cdcf; color: rgba(29, 34, 38, .46); cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) {
  .quick-prompts button,
  .brief-row > i,
  .planning-entry-list button,
  .legacy-place,
  .legacy-sidebar,
  .agent-panel { transition: none; }
  .quick-prompts button:hover { transform: none; }
  .activity-list li.running .activity-mark,
  .thinking-mark i { animation: none; }
}
.legacy-sidebar { position: absolute; top: 20px; bottom: 20px; left: 20px; z-index: 2; width: 360px; min-width: 0; overflow: hidden; border: 1px solid rgba(29, 34, 38, .18); border-radius: 8px; background: rgba(216, 220, 221, .94); box-shadow: var(--cross-shadow); }
.legacy-sidebar-content { display: flex; height: 100%; flex-direction: column; gap: 14px; overflow-y: auto; padding: 14px; box-sizing: border-box; }
.route-ticket { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; border: 1px dashed rgba(32, 37, 41, .24); border-radius: 5px 12px 5px 6px; background: rgba(220, 223, 222, .62); padding: 10px 12px; transform: rotate(-.18deg); }
.route-ticket strong { grid-column: 1 / -1; color: var(--cross-ink); font-size: 14px; }
.route-endpoints { grid-column: 1 / -1; overflow: hidden; color: var(--cross-ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.route-ticket > span { color: var(--cross-ink-soft); font-size: 11px; }
.reservation-summary { justify-self: end; border: 0; border-bottom: 1px dashed currentColor; background: transparent; color: #a94732; padding: 0 0 2px; font: inherit; font-size: 11px; cursor: pointer; }
.reservation-summary:disabled { border-color: transparent; color: var(--cross-ink-soft); cursor: default; }
.reservation-summary:focus-visible, .reservation-list button:focus-visible { outline: 2px solid #5368ad; outline-offset: 2px; }
.reservation-list { grid-column: 1 / -1; display: grid; gap: 1px; border-top: 1px dashed var(--cross-ink-faint); padding-top: 5px; }
.reservation-list button { display: flex; justify-content: space-between; gap: 10px; border: 0; background: transparent; color: var(--cross-ink); padding: 5px 0; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.reservation-list button span { color: var(--cross-ink-soft); white-space: nowrap; }
.legacy-header { padding-bottom: 13px; border-bottom: 1px dashed #e1ded6; }
.legacy-header-row { display: flex; align-items: baseline; gap: 14px; color: var(--cross-ink); font-size: 16px; }
.legacy-header-row strong { letter-spacing: .04em; }
.legacy-sample, .legacy-header-row .clear-route-action { border: 0; border-bottom: 1px solid rgba(48, 56, 61, .28); border-radius: 0; background: transparent; color: var(--cross-ink-soft); padding: 2px 1px; font: inherit; font-size: 11px; cursor: pointer; }
.legacy-header-row .clear-route-action { margin-left: auto; }
.legacy-sample:hover { border-bottom-color: #5D7FA3; color: var(--cross-ink); }
.legacy-header-row .clear-route-action:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.legacy-header-row .clear-route-action:disabled { opacity: .45; cursor: not-allowed; }
.legacy-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.legacy-actions button { margin: 0; background: transparent; color: var(--cross-ink); padding: 8px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.legacy-actions .new-route-action { border: 0; border-bottom: 1px solid var(--cross-ink-faint); border-radius: 0; padding-right: 2px; padding-left: 2px; }
.legacy-actions .new-route-action:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.legacy-actions .save-route-action { display: inline-flex; align-items: center; border: 1.5px solid #5368ad; border-radius: 6px 10px 7px 9px; background: rgba(101, 117, 172, .08); }
.legacy-actions .save-route-action:hover { background: rgba(101, 117, 172, .16); }
.save-check { width: 20px; height: 18px; margin-left: 6px; color: #5368ad; }
.save-check path { stroke-dasharray: 30; stroke-dashoffset: 30; animation: save-check-draw .5s ease-out forwards; }
@keyframes save-check-draw { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) { .save-check path { animation: none; stroke-dashoffset: 0; } }
.legacy-actions button:disabled { opacity: .55; cursor: not-allowed; }
.legacy-days { display: flex; flex-wrap: wrap; gap: 7px 12px; padding-bottom: 12px; border-bottom: 1px dashed rgba(32, 37, 41, .16); }
.legacy-days button { position: relative; border: 0; background: transparent; color: #46545e; padding: 6px 1px 8px 15px; font: inherit; font-size: 12px; cursor: pointer; }
.legacy-days button::before { position: absolute; top: 11px; left: 2px; width: 7px; height: 7px; border-radius: 48% 55% 44% 58%; background: var(--day-color, var(--cross-ink-faint)); content: ''; }
.legacy-days .overview-tab::before { background: var(--cross-ink); }
.legacy-days .unscheduled-tab::before { border: 1px solid var(--cross-ink-faint); background: transparent; }
.legacy-days button::after { position: absolute; right: 0; bottom: 3px; left: 12px; height: 2px; border-radius: 55% 42% 58% 40%; background: var(--day-color, var(--cross-ink)); content: ''; opacity: 0; transform: rotate(-1deg); }
.legacy-days button:hover, .legacy-days button.active { color: var(--cross-ink); font-weight: 600; }
.legacy-days button.active::after { opacity: .9; }
.legacy-days .day-count-action { display: inline-flex; width: 44px; min-width: 44px; min-height: 44px; align-items: center; justify-content: center; border: 0; color: var(--cross-ink); padding: 0; font-size: 16px; line-height: 1; }
.legacy-days .day-count-action span { display: flex; width: 38px; height: 29px; align-items: center; justify-content: center; border: 1px dashed rgba(70, 84, 94, .5); border-radius: 9px; box-sizing: border-box; }
.legacy-days .day-count-action::before, .legacy-days .day-count-action::after { display: none; }
.legacy-days .day-count-action:disabled { opacity: .35; cursor: not-allowed; }
.day-summary { margin: -8px 2px 0; color: var(--cross-ink-soft); font-size: 11px; line-height: 1.5; }
.legacy-list { flex: 1; min-height: 260px; overflow-x: hidden; overflow-y: auto; }
.pending-heading { display: flex; align-items: baseline; gap: 12px; padding: 5px 2px 13px; border-bottom: 1px solid rgba(32, 37, 41, .2); }
.pending-heading strong { color: var(--cross-ink); font-size: 15px; }
.pending-heading strong span { margin-left: 3px; color: var(--cross-ink-soft); font-weight: 450; }
.pending-heading small { color: var(--cross-ink-soft); font-size: 11px; }
.transport-segment-row { position: relative; margin-left: 12px; border-left: 1px dashed rgba(32, 37, 41, .24); padding: 4px 0 4px 20px; }
.transport-segment-summary { display: flex; width: 100%; min-height: 34px; align-items: center; justify-content: space-between; gap: 8px; border: 0; background: transparent; color: #46545e; padding: 4px 2px; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.transport-segment-summary:hover, .transport-segment-summary:focus-visible { color: var(--cross-ink); outline: none; }
.transport-description { display: inline-flex; min-width: 0; align-items: center; gap: 5px; }
.walking-steps { display: inline-flex; align-items: center; flex: 0 0 auto; gap: 1px; color: #5368ad; }
.walking-steps svg { width: 8px; height: 12px; }
.walking-steps svg:nth-child(even) { transform: translateY(-2px) rotate(12deg); }
.transport-expand-mark { color: var(--cross-ink-faint); white-space: nowrap; }
.transport-retry { min-height: 32px; border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink-soft); padding: 2px 0; font: inherit; font-size: 11px; cursor: pointer; }
.transport-mode-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; padding: 4px 0 6px; }
.transport-mode-options button { display: grid; min-width: 0; min-height: 44px; justify-items: center; align-content: center; gap: 1px; border: 1px solid rgba(32, 37, 41, .2); border-radius: 5px 10px 6px 8px; background: transparent; color: var(--cross-ink-soft); font: inherit; font-size: 10px; cursor: pointer; }
.transport-mode-options svg { width: 21px; height: 21px; }
.transport-mode-options button:hover, .transport-mode-options button.active { border-color: #6575ac; color: var(--cross-ink); background: rgba(101, 117, 172, .08); }
.legacy-empty { display: grid; justify-items: center; gap: 14px; padding: 60px 14px 0; color: var(--cross-ink-soft); font-size: 12px; line-height: 1.6; text-align: center; }
.empty-journey { position: relative; width: 150px; height: 90px; }
.empty-journey svg { position: absolute; left: 0; bottom: 2px; width: 150px; height: 48px; fill: none; stroke: #6575ac; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 1 6; }
.empty-journey svg circle { fill: #6575ac; stroke: none; }
.empty-journey img { position: absolute; right: 10px; bottom: 12px; width: 33px; height: 70px; object-fit: contain; }
.legacy-empty button { border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink); padding: 3px 0; font: inherit; cursor: pointer; }
.legacy-empty button:focus-visible { outline: 2px solid #5368ad; outline-offset: 2px; }
.route-source-tabs { display: flex; gap: 10px; border-bottom: 1px solid rgba(32, 37, 41, .14); padding-bottom: 8px; }
.route-source-tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--cross-ink-soft); padding: 3px 0; font: inherit; font-size: 12px; cursor: pointer; }
.route-source-tabs button.active { border-bottom-color: var(--cross-rust); color: var(--cross-ink); font-weight: 650; }
.legacy-place { position: relative; display: flex; align-items: flex-start; gap: 10px; margin: 0; border: 0; border-bottom: 1px solid rgba(29, 34, 38, .12); border-radius: 0; background: transparent; padding: 11px 2px; cursor: pointer; transition: background-color .18s ease; }
.legacy-place:hover { background: rgba(95, 114, 103, .07); box-shadow: none; }
.legacy-place.selected { background: rgba(83, 104, 173, .09); }
.legacy-place.selected::before { position: absolute; top: 23px; left: -2px; width: 6px; height: 6px; border-radius: 48% 55% 44% 58%; background: #d97546; box-shadow: 0 0 0 3px rgba(217, 117, 70, .15); content: ''; }
.legacy-place.pending-card { align-items: center; min-height: 54px; padding: 10px 5px; }
.legacy-place.pending-card.expanded { align-items: flex-start; margin: 8px 0; border: 1px solid rgba(32, 37, 41, .25); border-radius: 5px 15px 6px 9px; background: rgba(235, 238, 242, .6); padding: 13px 9px; }
.legacy-order { position: relative; display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--day-color, var(--cross-ink-soft)); }
.legacy-order svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.legacy-order > span { position: relative; color: var(--cross-ink); font-size: 12px; font-weight: 550; }
.legacy-place.selected .legacy-order { filter: drop-shadow(0 0 3px rgba(83, 104, 173, .3)); }
.legacy-place > div:nth-child(2) { min-width: 0; flex: 1; }
.legacy-place strong, .legacy-place small { display: block; }
.legacy-place strong { overflow: hidden; color: var(--cross-ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.legacy-place .place-title { display: flex; align-items: center; gap: 4px; }
.place-title svg { width: 17px; height: 17px; flex: 0 0 auto; color: #46617f; }
.place-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.legacy-place small { overflow: hidden; margin-top: 4px; color: #505c66; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.reservation-badge { display: inline-flex; min-width: 16px; height: 16px; align-items: center; justify-content: center; vertical-align: 1px; font-size: 10px; line-height: 1; }
.reservation-badge.required { border: 1px dashed #a94732; border-radius: 5px; color: #a94732; }
.reservation-badge.booked { border-radius: 4px; background: #5368ad; color: #fff; }
.pending-day-options { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 14px; }
.pending-day-options > span { margin-right: 3px; color: var(--cross-ink-soft); font-size: 12px; }
.pending-day-options button { min-height: 32px; border: 1.5px solid var(--day-color, #818a94); border-radius: 16px 13px 15px 14px; background: transparent; color: var(--cross-ink); padding: 4px 8px; font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.pending-day-options button:hover, .pending-day-options button:focus-visible { background: rgba(101, 117, 172, .12); outline: none; }
.pending-day-options .add-day { min-width: 32px; border-style: dashed; color: var(--cross-ink-soft); }
.pending-card .legacy-place-actions { opacity: 1; pointer-events: auto; }
.pending-card.expanded .legacy-place-actions .pending-expand { display: none; }
.pending-expand { color: #486f86 !important; white-space: nowrap; }
.legacy-place-actions { display: flex; gap: 3px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
.legacy-place:hover .legacy-place-actions, .legacy-place:focus-within .legacy-place-actions, .legacy-place.selected .legacy-place-actions { opacity: 1; pointer-events: auto; }
.legacy-place-actions button { border: 0; border-bottom: 1px solid var(--cross-ink-faint); border-radius: 0; background: transparent; color: var(--cross-ink-soft); padding: 3px 2px; font: inherit; font-size: 11px; cursor: pointer; }
.legacy-place-actions button:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.legacy-place-actions button:last-child { color: var(--cross-ink-soft); }
.legacy-place-actions button:disabled { opacity: .45; cursor: not-allowed; }
.day-select { min-width: 48px; border: 0; border-bottom: 1px solid rgba(72, 111, 134, .38); border-radius: 0; background: transparent; color: #486f86; padding: 3px 1px; font: inherit; font-size: 11px; cursor: pointer; outline: none; }
.day-select:focus { border-bottom-color: #365f78; }
.legacy-route-info { display: flex; flex-direction: column; gap: 4px; border: 1px dashed rgba(29, 34, 38, .22); border-radius: 7px; background: rgba(220, 223, 222, .72); padding: 12px; color: var(--cross-muted); font-size: 12px; }
.legacy-route-info strong { color: var(--cross-ink); font-size: 14px; }
.map-toolbar { top: 20px; left: 400px; right: 400px; z-index: 2; gap: 6px; padding: 8px 12px; overflow: visible; border-radius: 8px; background: rgba(216,220,221,.88); box-shadow: 0 2px 12px rgba(29,34,38,.1); }
.map-toolbar :deep(.poi-search) { width: auto; min-width: 0; flex: 1 1 180px; }
.map-toolbar :deep(.search-input) { min-width: 0; }
.toolbar-divider { background: transparent; }
.toolbar-button { position: relative; display: grid; width: 32px; height: 32px; place-items: center; flex: 0 0 auto; border: 0; border-bottom: 1px solid var(--cross-ink-faint); border-radius: 0; background: transparent; color: var(--cross-ink-soft); padding: 6px; font-size: 16px; }
.toolbar-button svg, .route-line-toggle svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.toolbar-button > span, .route-line-toggle > span { position: absolute; top: calc(100% + 6px); left: 50%; z-index: 3; width: max-content; transform: translateX(-50%); border: 1px solid rgba(32, 37, 41, .16); background: rgba(216, 220, 221, .98); color: var(--cross-ink); padding: 3px 6px; font-size: 10px; opacity: 0; pointer-events: none; }
.toolbar-button:hover > span, .toolbar-button:focus-visible > span, .route-line-toggle:hover > span { opacity: 1; }
.toolbar-button:hover, .toolbar-button.active { border-bottom-color: var(--cross-rust); background: transparent; color: var(--cross-rust); }
.route-line-toggle { position: relative; display: inline-flex; width: 32px; min-height: 32px; align-items: center; justify-content: center; color: var(--cross-ink-soft); font-size: 16px; cursor: pointer; white-space: nowrap; }
.route-line-toggle input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.route-line-toggle input:checked + svg { color: #5368ad; }
.route-line-toggle input:focus-visible + svg { outline: 2px solid #5368ad; outline-offset: 4px; }
.route-line-toggle:focus-within { color: var(--cross-ink); }
.map-retry { color: var(--cross-rust); }
@media (max-width: 1180px) { .legacy-sidebar { width: 340px; } .agent-panel { width: 300px; } .map-toolbar { left: 380px; right: 340px; } .draft-map-banner { left: 380px; max-width: min(360px, calc(100% - 720px)); } }
@media (max-width: 900px) {
  .map-view { height: 100%; overflow: hidden; }
  .workspace { height: 100%; min-height: 0; }
  .map-stage { inset: 0; height: 100%; visibility: visible; pointer-events: auto; opacity: 1; }
  .point-form-open .map-stage { z-index: 25; }
  .legacy-sidebar {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 20;
    width: auto;
    height: 44dvh;
    border-width: 1px 0 0;
    border-radius: 18px 18px 0 0;
    background: rgba(216, 220, 221, .97);
    box-shadow: 0 -7px 24px rgba(29, 34, 38, .14);
    overflow: visible;
    transition: height .24s ease;
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
  }
  .mobile-sheet-collapsed .legacy-sidebar { height: 148px; }
  .mobile-sheet-expanded .legacy-sidebar { height: calc(100% - 72px); }
  .mobile-agent-open .legacy-sidebar { height: 112px; pointer-events: none; }
  .mobile-sheet-handle {
    position: absolute;
    z-index: 3;
    top: 0;
    left: 0;
    display: flex;
    width: calc(100% - 148px);
    height: 44px;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    touch-action: none;
    cursor: ns-resize;
  }
  .mobile-sheet-handle span { width: 34px; height: 4px; border-radius: 3px; background: rgba(32, 37, 41, .28); }
  .mobile-companion-launcher {
    position: absolute;
    z-index: 4;
    top: -48px;
    right: 12px;
    display: flex;
    width: auto;
    max-width: calc(100% - 28px);
    height: 52px;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }
  .mobile-companion-launcher :deep(svg) { width: 48px; height: 48px; flex: 0 0 auto; filter: drop-shadow(0 3px 5px rgba(29, 34, 38, .15)); }
  .mobile-companion-launcher > span { max-width: 180px; border: 1px solid rgba(32, 37, 41, .2); border-radius: 12px 5px 12px 4px; background: rgba(216, 220, 221, .96); color: var(--cross-ink); padding: 7px 9px; font-size: 11px; line-height: 1.35; box-shadow: 0 3px 9px rgba(29, 34, 38, .1); }
  .workspace.right-collapsed .agent-panel { width: auto; }
  .legacy-sidebar-content { gap: 10px; padding: 32px 12px max(12px, env(safe-area-inset-bottom)); }
  .mobile-sheet-summary { display: none; min-height: 26px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 2px; }
  .mobile-sheet-collapsed .mobile-sheet-summary { display: flex; }
  .mobile-sheet-summary strong { color: var(--cross-ink); font-size: 16px; }
  .mobile-sheet-summary span { color: var(--cross-ink-soft); font-size: 10px; }
  .legacy-sidebar-content { overflow-y: auto; border-radius: inherit; background: rgba(216, 220, 221, .97); }
  .mobile-sheet-collapsed .legacy-sidebar-content { overflow: hidden; }
  .mobile-sheet-collapsed .legacy-header,
  .mobile-sheet-collapsed .route-ticket,
  .mobile-sheet-collapsed .legacy-actions,
  .mobile-sheet-collapsed .route-source-tabs,
  .mobile-sheet-collapsed .legacy-list,
  .mobile-sheet-collapsed .legacy-route-info { display: none; }
  .legacy-header-row { flex-wrap: wrap; gap: 8px; }
  .legacy-actions { display: flex; }
  .legacy-actions button,
  .legacy-days button,
  .legacy-place-actions button { min-height: 44px; }
  .transport-segment-summary, .transport-retry, .transport-mode-options button { min-height: 44px; }
  .legacy-days { flex: 0 0 auto; flex-wrap: nowrap; overflow-x: auto; padding-bottom: 7px; scrollbar-width: none; }
  .legacy-days button { flex: 0 0 auto; white-space: nowrap; }
  .legacy-days::-webkit-scrollbar { display: none; }
  .legacy-list { min-height: 0; }
  .legacy-place { min-height: 58px; align-items: center; }
  .legacy-place-actions button { min-width: 40px; border-bottom: 0; }
  .legacy-place-actions { opacity: 1; pointer-events: auto; }
  .legacy-place-actions > button { display: none; }
  .pending-card .legacy-place-actions .pending-expand { display: block; }
  .pending-card.expanded .legacy-place-actions .pending-expand { display: none; }
  .legacy-place.swiped .legacy-place-actions .place-edit,
  .legacy-place.swiped .legacy-place-actions .place-delete,
  .legacy-place-actions:focus-within .place-edit,
  .legacy-place-actions:focus-within .place-delete { display: block; }
  .day-select { min-width: 56px; min-height: 44px; }
  .pending-day-options button { min-width: 44px; min-height: 44px; }
  .pending-expand { min-width: 48px !important; min-height: 44px; }
  .map-toolbar {
    top: 8px;
    right: 8px;
    left: 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    grid-template-rows: auto repeat(3, 44px);
    gap: 6px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    overflow: visible;
    pointer-events: none;
  }
  .map-toolbar :deep(.poi-search) { grid-column: 1; grid-row: 1; width: 100%; pointer-events: auto; }
  .map-toolbar .toolbar-button, .map-toolbar .route-line-toggle { grid-column: 2; width: 44px; height: 44px; border: 1px solid rgba(32, 37, 41, .18); border-radius: 50%; background: rgba(216, 220, 221, .94); box-shadow: 0 2px 8px rgba(29, 34, 38, .1); pointer-events: auto; }
  .map-toolbar .toolbar-button:nth-of-type(1) { grid-row: 1; }
  .map-toolbar .toolbar-button:nth-of-type(2), .map-toolbar .toolbar-button:nth-of-type(3), .map-toolbar .toolbar-button:nth-of-type(4) { display: none; }
  .map-toolbar .toolbar-button:nth-of-type(5) { grid-row: 2; }
  .map-toolbar .route-line-toggle { grid-row: 3; }
  .map-toolbar .toolbar-button > span, .map-toolbar .route-line-toggle > span { display: none; }
  .poi-preview-card { top: 72px; width: min(340px, calc(100% - 28px)); }
  .poi-preview-close, .poi-add-action, .poi-preview-actions .text-action { min-height: 44px; }
  .toolbar-divider { display: none; }
  .toolbar-button { min-height: 44px; padding: 6px; font-size: 18px; }
  .route-line-toggle { min-height: 44px; justify-content: center; font-size: 18px; }
  .draft-map-banner { top: 126px; left: 10px; max-width: calc(100% - 20px); }
  .agent-panel {
    top: 10px;
    right: 8px;
    bottom: 0;
    left: 8px;
    z-index: 30;
    width: auto;
    height: calc(100dvh - 10px);
    border-radius: 16px 16px 0 0;
    background: rgba(216, 220, 221, .99);
    visibility: hidden;
    pointer-events: none;
    opacity: 0;
    transform: translateY(28px);
    transition: opacity .18s ease, transform .18s ease;
  }
  .agent-panel.mobile-agent-visible { visibility: visible; pointer-events: auto; opacity: 1; transform: translateY(0); }
  .agent-title { padding: 10px 12px 9px; }
  .agent-title .icon-button { width: 44px; height: 44px; font-size: 28px; transform: rotate(90deg); }
  .collapsed-rail { display: none; }
  .trip-brief { grid-template-columns: auto repeat(3, minmax(0, 1fr)); padding: 8px 10px; }
  .brief-editor { padding-left: 8px; }
  .agent-scroll { padding: 12px 12px 8px; }
  .chat-message { max-width: 94%; }
  .agent-input {
    padding: 10px max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
  }
  .agent-input textarea { min-height: 48px; }
  .send-button { min-width: 58px; min-height: 48px; }
}

@media (max-width: 420px) {
  .legacy-place-actions { display: flex; }
  .trip-brief { grid-template-columns: 1fr; }
  .brief-label { display: none; }
  .brief-item.active { grid-column: 1; }
}
</style>
