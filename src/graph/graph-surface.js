/** 会话云图（Obsidian 图谱那种）：一个会话 = 一个点。
 *
 *  只画点，不画卡片/框/分组药丸 —— 标题只在鼠标移到点上时才出现（画在屏幕空间，
 *  所以任何缩放级别都是同一个字号）。点的大小只由「它有多少条连线」决定，
 *  连线只有三种来源：同一个工作区、同一个标签、子代理（血缘）。
 *
 *  位置由一个持续力导向模拟维护：全对全斥力 + 按半径算的硬芯（两点的圆永远不会
 *  叠在一起）+ 边弹簧。拖动一个点会把它钉在指针下，其余节点继续找平衡。
 *
 *  交互与旧版一致：滚轮缩放、空白拖动平移、双击空白新建会话、shift 拖出连
 *  线分叉、右键卡片菜单、单击打开会话；悬停高亮 / 聚焦（spotlight）压暗规则
 *  也保持原样，只是从「卡片描边」换成了「点的高亮环」。
 */
function GraphCanvasSurface(props) {
  var react = import_react13;
  var rootRef = react.useRef(null);
  var canvasRef = react.useRef(null);
  var propsRef = react.useRef(props);
  propsRef.current = props;
  var cameraRef = react.useRef(null);
  if (cameraRef.current === null) cameraRef.current = readGraphCamera();
  var dragRef = react.useRef(null);
  var frameRef = react.useRef(0);
  var hoverRef = react.useRef(null);
  /** 点选（pin）住的关键词点：鼠标移开也继续高亮它和它的会话，点空白处取消。 */
  var pickedRef = react.useRef(null);
  var drawRef = react.useRef(function () { });
  var fitRef = react.useRef(null);

  // ---- 力导向模拟 -------------------------------------------------------
  // 位置存在 ref 里，只在收敛后写一次 store（每帧写库会把宿主拖死）。
  var simRef = react.useRef(null);
  var tweenRef = react.useRef(null);
  var forkRef = react.useRef(null);
  // 外部写入过坐标（「重新排布」/ 恢复布局）时要丢掉模拟里的旧坐标重新播种。
  var reseedRef = react.useRef(false);
  // 只有布局版本失效或用户重排时才重新铺盘；普通重挂载必须沿用已保存坐标。
  var discSeedRef = react.useRef(false);
  /** 「⟲ 重新排布」把坐标写完之后要自动缩放到合适大小（收敛后再来一次）。 */
  var pendingFitRef = react.useRef(false);

  // ---- 点几何 -----------------------------------------------------------
  // 半径只跟度数有关：没有连线的点是 2.4px，之后按 sqrt(度数) 长；
  // 上限 15px，免得一个巨型工作区的中心点吃掉半屏。
  var DOT_MIN_R = 1.7;
  var DOT_MAX_R = 11;
  var DOT_R_SCALE = 1.3;
  /** 「布局引擎版本」前缀：改了布局算法就换一个，旧签名自动失效、重排一次。 */
  var CLOUD_LAYOUT_TAG = "cloud-v1:";
  var DOT_LABEL_MAX_W = 280;

  var simSettings = {
    // 给「点」调的一套参数：节点只有几 px，弹簧长度因此按 50 上下算，
    // 比卡片版的 200 短一个数量级，簇才会抱成一团而不是摊成一片。
    charge: -2600,         // 远距斥力
    linkDistance: 46,      // 边的自然长度（实际再各自加上两端的半径）
    collisionGap: 7,       // 硬芯余量：圆心距小于 rA + rB + 这个值就线性弹开
    collisionPush: 0.55,   // 硬芯强度
    stiffness: 0.06,       // 弹簧常数（未超过上限时）
    stiffCeiling: 0.35,    // 被拉得太长时的硬弹簧
    maxStretch: 1.5,
    gravity: 0.005,        // 轻微向心，防止孤立点飞走
    repulsionRange: 420,   // 超出这个距离不再互推，整体更紧凑
    forceScale: 1,
    velocityDecay: 0.45,   // 重阻尼：松手就停，不滑行
    maxVelocity: 26,
    alphaDecay: 0.955,     // 静止到收敛约 2 秒
    alphaMin: 0.004
  };

  /** id -> 连线数。每帧算一次就够（169 个点、几百条边）。 */
  var linkDegrees = function () {
    var edges = propsRef.current.edges || [];
    var degrees = new Map();
    for (var index = 0; index < edges.length; index += 1) {
      var edge = edges[index];
      degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
      degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
    }
    return degrees;
  };
  var radiusFor = function (degree) {
    var value = DOT_MIN_R + DOT_R_SCALE * Math.sqrt(degree === void 0 || degree < 0 ? 0 : degree);
    return value > DOT_MAX_R ? DOT_MAX_R : value;
  };

  var visibleNodes = function () {
    var out = [];
    var nodes = propsRef.current.nodes || [];
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (node.hidden === true) continue;
      // sessionCard / sessionDot = 会话点；tagNode = 关键词（标签）点。
      if (node.type !== "sessionCard" && node.type !== "sessionDot" && node.type !== "tagNode") continue;
      out.push(node);
    }
    return out;
  };

  /** 字符串 id 的稳定散列：用来给重播种的点一个确定但彼此不同的角度。 */
  var hashOf = function (text) {
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = (hash * 16777619) >>> 0;
    }
    return hash;
  };

  /** 全体重排时的播种：把点摊在一个「向日葵盘」（Vogel spiral）上。
   * 度数高的点先放、落在盘心，孤立的点甩到边缘 —— 这样一开始就是各向同性的，
   * 不会因为旧的坐标是一列/一条而退化成香肠形；随后的力导向只做微调。
   * 盘心沿用旧坐标的质心，镜头因此不会被甩到别处。 */
  var seedDisc = function (sim) {
    var ids = [];
    sim.nodes.forEach(function (value, key) { ids.push(key); });
    var count = ids.length;
    if (count < 2) return;
    var degrees = linkDegrees();
    ids.sort(function (left, right) {
      var delta = (degrees.get(right) || 0) - (degrees.get(left) || 0);
      if (delta !== 0) return delta;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    var centreX = 0;
    var centreY = 0;
    sim.nodes.forEach(function (state) { centreX += state.x; centreY += state.y; });
    centreX = centreX / count;
    centreY = centreY / count;
    var step = 52;
    var radius = step * Math.sqrt(count) * 0.55;
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var index = 0; index < count; index += 1) {
      var state = sim.nodes.get(ids[index]);
      var local = radius * Math.sqrt((index + 0.5) / count);
      var angle = index * golden;
      state.x = centreX + Math.cos(angle) * local;
      state.y = centreY + Math.sin(angle) * local;
      state.vx = 0;
      state.vy = 0;
    }
  };

  /** 关键词点（tag hub）不存坐标：每次播种都按它连着的会话的质心落位，
   * 再交给力导向去微调。这样加/删会话后它永远落在自己那一簇的中间。 */
  var seatTagNodes = function (sim, tagIds) {
    var edges = propsRef.current.edges || [];
    for (var index = 0; index < tagIds.length; index += 1) {
      var tagId = tagIds[index];
      var state = sim.nodes.get(tagId);
      if (state === void 0) continue;
      var sumX = 0;
      var sumY = 0;
      var hits = 0;
      for (var edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        var edge = edges[edgeIndex];
        var other = null;
        if (edge.source === tagId) other = edge.target;
        else if (edge.target === tagId) other = edge.source;
        else continue;
        var peer = sim.nodes.get(other);
        if (peer === void 0) continue;
        sumX += peer.x;
        sumY += peer.y;
        hits += 1;
      }
      if (hits === 0) continue;
      // 质心 + 一点确定性抖动：两个共用同一批会话的 key 点不会叠在一起。
      var hash = hashOf(tagId);
      var angle = (hash % 360) * Math.PI / 180;
      state.x = sumX / hits + Math.cos(angle) * 14;
      state.y = sumY / hits + Math.sin(angle) * 14;
      state.vx = 0;
      state.vy = 0;
    }
  };

  var ensureSim = function () {
    var sim = simRef.current;
    if (sim === null) { sim = { nodes: new Map(), alpha: 0 }; simRef.current = sim; }
    if (reseedRef.current === true) {
      reseedRef.current = false;
      sim.nodes.clear();
    }
    var nodes = visibleNodes();
    var alive = new Set();
    var seeded = 0;
    var seededTags = [];
    var idle = sim.alpha <= simSettings.alphaMin;
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      alive.add(node.id);
      var state = sim.nodes.get(node.id);
      if (state === void 0) {
        // 默认精确恢复持久化位置；需要全体播种时由下面的 seedDisc 分配新坐标。
        sim.nodes.set(node.id, {
          x: node.position.x,
          y: node.position.y,
          vx: 0,
          vy: 0
        });
        seeded += 1;
        if (node.type === "tagNode") seededTags.push(node.id);
        continue;
      }
      // 模拟静止时以 store 为准：外部写入（重排 / 拖动落库 / 自动同步摆位）
      // 不能被上一帧的 tick 覆盖掉。
      if (idle && node.type !== "tagNode") {
        state.x = node.position.x;
        state.y = node.position.y;
        state.vx = 0;
        state.vy = 0;
      }
    }
    var stale = [];
    sim.nodes.forEach(function (value, key) { if (!alive.has(key)) stale.push(key); });
    for (var drop = 0; drop < stale.length; drop += 1) sim.nodes.delete(stale[drop]);
    // 全部都是新的（首次挂载 / 重新排布 / 成员大改）= 拿盘状播种；
    // 只多了一两个新会话时就让它落在原来的位置附近，不要把整张图推倒重来。
    if (discSeedRef.current && sim.nodes.size > 1) {
      discSeedRef.current = false;
      seedDisc(sim);
    }
    if (seededTags.length > 0) seatTagNodes(sim, seededTags);
    return sim;
  };

  var reheat = function (value) {
    var sim = ensureSim();
    if (sim.alpha < value) sim.alpha = value;
  };

  var tickSim = function () {
    var sim = ensureSim();
    var settings = simSettings;
    if (sim.alpha <= settings.alphaMin) return false;
    var ids = [];
    sim.nodes.forEach(function (value, key) { ids.push(key); });
    var count = ids.length;
    var list = [];
    var centroidX = 0;
    var centroidY = 0;
    for (var index = 0; index < count; index += 1) {
      var state = sim.nodes.get(ids[index]);
      state.fx = 0;
      state.fy = 0;
      list.push(state);
      centroidX += state.x;
      centroidY += state.y;
    }
    centroidX = count === 0 ? 0 : centroidX / count;
    centroidY = count === 0 ? 0 : centroidY / count;
    var alpha = sim.alpha;
    var degrees = linkDegrees();
    var radii = new Array(count);
    for (var radiusIndex = 0; radiusIndex < count; radiusIndex += 1) radii[radiusIndex] = radiusFor(degrees.get(ids[radiusIndex]) || 0);
    // 关键词点之间互斥更强：共用同一批会话的两个 key，质心几乎重合，
    // 只按普通硬芯会挤成一团"核心结节"；加大间距后它们在中心摊成一圈。
    var tagIds = new Set();
    var allNodes = propsRef.current.nodes || [];
    for (var tagScan = 0; tagScan < allNodes.length; tagScan += 1) {
      if (allNodes[tagScan].type === "tagNode") tagIds.add(allNodes[tagScan].id);
    }

    // 全对全斥力 + 半径硬芯：圆心距小于 rA + rB + gap 时用线性斥力弹开，
    // 所以两个点的圆永远（近似）不会叠在一起 —— 这是「不要重合」那一条。
    for (var left = 0; left < count; left += 1) {
      for (var right = left + 1; right < count; right += 1) {
        var deltaX = list[right].x - list[left].x;
        var deltaY = list[right].y - list[left].y;
        var distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared < 1) {
          // 完全重合：按确定的轴推开一点，免得两点焊死。
          deltaX = 0.7 + left * 0.001;
          deltaY = 0.7 + right * 0.001;
          distanceSquared = deltaX * deltaX + deltaY * deltaY;
        }
        var distance = Math.sqrt(distanceSquared);
        var bothTags = tagIds.has(ids[left]) && tagIds.has(ids[right]);
        var core = radii[left] + radii[right] + settings.collisionGap * (bothTags ? 3.2 : 1);
        var push;
        if (distance < core) {
          // 硬芯不跟着 alpha 衰减：否则收敛尾段（alpha → 0）里剩下的重叠会
          // 直接凝固在那里。可见的「点叠在一起」几乎都是这么来的。
          push = -(core - distance) * settings.collisionPush * Math.max(alpha, 0.3) * settings.forceScale;
        } else {
          if (distance > settings.repulsionRange) continue;
          push = (settings.charge * (bothTags ? 2 : 1) / distanceSquared) * alpha * settings.forceScale;
        }
        var unitX = deltaX / distance;
        var unitY = deltaY / distance;
        list[left].fx += unitX * push;
        list[left].fy += unitY * push;
        list[right].fx -= unitX * push;
        list[right].fy -= unitY * push;
      }
    }

    // 边弹簧。同一对会话可能既是同工作区又同标签（两条边），所以每条边按
    // 2/(degA+degB) 归一，否则一个大工作区会被十几根弹簧压成一个点。
    var edges = propsRef.current.edges || [];
    var edgeDegree = degrees;
    for (var edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      var from = sim.nodes.get(edges[edgeIndex].source);
      var to = sim.nodes.get(edges[edgeIndex].target);
      if (from === void 0 || to === void 0) continue;
      var springX = to.x - from.x;
      var springY = to.y - from.y;
      var length = Math.sqrt(springX * springX + springY * springY);
      if (length < 0.5) length = 0.5;
      var edgeWeight = 2 / ((edgeDegree.get(edges[edgeIndex].source) || 1) + (edgeDegree.get(edges[edgeIndex].target) || 1));
      var touchesTag = tagIds.has(edges[edgeIndex].source) || tagIds.has(edges[edgeIndex].target);
      var rest = settings.linkDistance
        + radiusFor(edgeDegree.get(edges[edgeIndex].source) || 0)
        + radiusFor(edgeDegree.get(edges[edgeIndex].target) || 0)
        // 到关键词点的连线略长一点：key 因此浮在自己那一簇的边缘/中间，
        // 而不是被成员压进簇心。
        + (touchesTag ? 16 : 0);
      var stiffness = (length > rest * settings.maxStretch ? settings.stiffCeiling : settings.stiffness) * edgeWeight;
      var pull = (length - rest) * stiffness * alpha * settings.forceScale;
      var springUnitX = springX / length;
      var springUnitY = springY / length;
      from.fx += springUnitX * pull;
      from.fy += springUnitY * pull;
      to.fx -= springUnitX * pull;
      to.fy -= springUnitY * pull;
    }

    var drag = dragRef.current;
    var pinned = drag !== null && drag.kind === "node" && drag.preview !== null ? drag.preview : null;
    for (var step = 0; step < count; step += 1) {
      var node = list[step];
      // 被拖的点钉在指针下、不参与积分，其余点围绕它继续流动。
      if (pinned !== null && ids[step] === drag.id) {
        node.x = pinned.x;
        node.y = pinned.y;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.fx += (centroidX - node.x) * settings.gravity * alpha;
      node.fy += (centroidY - node.y) * settings.gravity * alpha;
      node.vx = (node.vx + node.fx) * settings.velocityDecay;
      node.vy = (node.vy + node.fy) * settings.velocityDecay;
      if (node.vx > settings.maxVelocity) node.vx = settings.maxVelocity;
      if (node.vx < -settings.maxVelocity) node.vx = -settings.maxVelocity;
      if (node.vy > settings.maxVelocity) node.vy = settings.maxVelocity;
      if (node.vy < -settings.maxVelocity) node.vy = -settings.maxVelocity;
      node.x += node.vx;
      node.y += node.vy;
    }
    sim.alpha = alpha * (count > 120 ? 0.985 : settings.alphaDecay);
    return true;
  };

  /** 收敛后做一遍纯几何去重叠（不吃 alpha），保证"两个圆不重合"是真的。
   * 80 轮足够把几十个贴在一起的点推开，一次性的开销（O(n²)）可以忽略。 */
  var resolveOverlaps = function (sim) {
    var degrees = linkDegrees();
    var ids = [];
    sim.nodes.forEach(function (value, key) { ids.push(key); });
    var count = ids.length;
    if (count < 2) return;
    var radii = new Array(count);
    for (var radiusIndex = 0; radiusIndex < count; radiusIndex += 1) radii[radiusIndex] = radiusFor(degrees.get(ids[radiusIndex]) || 0);
    var tagIds = new Set();
    var allNodes = propsRef.current.nodes || [];
    for (var tagScan = 0; tagScan < allNodes.length; tagScan += 1) {
      if (allNodes[tagScan].type === "tagNode") tagIds.add(allNodes[tagScan].id);
    }
    for (var pass = 0; pass < 80; pass += 1) {
      var moved = false;
      for (var left = 0; left < count; left += 1) {
        var first = sim.nodes.get(ids[left]);
        for (var right = left + 1; right < count; right += 1) {
          var second = sim.nodes.get(ids[right]);
          var deltaX = second.x - first.x;
          var deltaY = second.y - first.y;
          var distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          var bothTags = tagIds.has(ids[left]) && tagIds.has(ids[right]);
          var core = radii[left] + radii[right] + simSettings.collisionGap * (bothTags ? 1.8 : 0.5);
          if (distance >= core) continue;
          if (distance < 0.001) {
            deltaX = 0.6 + left * 0.001;
            deltaY = 0.6 + right * 0.001;
            distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          }
          var shift = (core - distance) / 2;
          first.x -= (deltaX / distance) * shift;
          first.y -= (deltaY / distance) * shift;
          second.x += (deltaX / distance) * shift;
          second.y += (deltaY / distance) * shift;
          moved = true;
        }
      }
      if (!moved) break;
    }
  };

  /** 收敛后把坐标写回插件 store —— 一次，不是每帧。
   * 走 tap bridge：moveCards 是唯一不会重新触发拖放/点击逻辑的入口。 */
  var commitSim = function () {
    var sim = simRef.current;
    if (sim === null) return;
    var live = mindMapTapBridge.live;
    if (live === null || typeof live.commit !== "function") return;
    resolveOverlaps(sim);
    var byId = new Map();
    var nodes = propsRef.current.nodes || [];
    for (var index = 0; index < nodes.length; index += 1) byId.set(nodes[index].id, nodes[index]);
    var points = {};
    var any = false;
    sim.nodes.forEach(function (state, key) {
      var x = Math.round(state.x);
      var y = Math.round(state.y);
      var node = byId.get(key);
      if (node === void 0) return;
      // 关键词点的坐标是派生的，不落库（store 里没有这张"卡"）。
      if (node.type !== "sessionCard" && node.type !== "sessionDot") return;
      if (Math.abs(node.position.x - x) < 1 && Math.abs(node.position.y - y) < 1) return;
      points[key] = { x: x, y: y };
      any = true;
    });
    if (any) live.commit(points);
    // 收敛后：记住这次布局的成员签名（下次挂载成员没变就不再重排），
    // 点过「重新排布」的话顺手把镜头缩放到合适大小。
    // 签名带一个「布局引擎版本」前缀：旧白板时代存下来的签名一定对不上，
    // 于是升级到云图后的第一次打开会强制重排一次，而不是把旧板子的坐标
    // 当成"已经收好的云图"直接展示出来。
    try { window.localStorage.setItem(MIND_MAP_LAID_SIG_KEY, CLOUD_LAYOUT_TAG + laidSignatureRef.current); } catch (error) { }
    if (pendingFitRef.current === true) {
      pendingFitRef.current = false;
      fitRef.current({ ease: true });
      mindMapCameraTouched = false;
    } else if (mindMapCameraTouched !== true) {
      // 用户没碰过镜头：每��收敛都重新收到合适大小，否则内容被撑开后镜头
      // 会永久停在旧位置，出现贴边/出界。
      fitRef.current({ ease: true });
    }
  };

  var animateCameraTo = function (target, duration) {
    var camera = cameraRef.current;
    if (camera === null || duration <= 0) {
      cameraRef.current = target;
      writeGraphCamera(target);
      schedule();
      return;
    }
    tweenRef.current = {
      from: { x: camera.x, y: camera.y, zoom: camera.zoom },
      to: target,
      start: typeof performance !== "undefined" ? performance.now() : Date.now(),
      duration: duration
    };
    schedule();
  };

  var stepTween = function (now) {
    var tween = tweenRef.current;
    if (tween === null) return false;
    var progress = Math.min(1, (now - tween.start) / tween.duration);
    var eased = 1 - Math.pow(1 - progress, 3);
    cameraRef.current = {
      x: tween.from.x + (tween.to.x - tween.from.x) * eased,
      y: tween.from.y + (tween.to.y - tween.from.y) * eased,
      zoom: tween.from.zoom + (tween.to.zoom - tween.from.zoom) * eased
    };
    if (progress >= 1) {
      tweenRef.current = null;
      writeGraphCamera(cameraRef.current);
    }
    return true;
  };

  var schedule = function () {
    if (frameRef.current !== 0) return;
    frameRef.current = window.requestAnimationFrame(function () {
      frameRef.current = 0;
      drawRef.current();
    });
  };

  /** id -> { cx, cy, r, x, y, w, h }。x/y/w/h 是外接矩形，fit / 跳转沿用它们。 */
  var dotBoxes = function () {
    var drag = dragRef.current;
    var degrees = linkDegrees();
    var boxes = new Map();
    var nodes = visibleNodes();
    var sim = simRef.current;
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var position = node.position;
      var state = sim === null ? null : sim.nodes.get(node.id);
      // 模拟跑着的时候由它掌握坐标；读 node.position 会画出上一帧并和模拟打架。
      if (state !== void 0 && state !== null) position = { x: state.x, y: state.y };
      if (drag !== null && drag.kind === "node" && drag.id === node.id && drag.preview !== null) position = drag.preview;
      var radius = radiusFor(degrees.get(node.id) || 0);
      boxes.set(node.id, {
        cx: position.x, cy: position.y, r: radius,
        x: position.x - radius, y: position.y - radius, w: radius * 2, h: radius * 2
      });
    }
    return boxes;
  };

  fitRef.current = function (options) {
    var root = rootRef.current;
    if (root === null) return;
    var boxes = dotBoxes();
    if (boxes.size === 0) return;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    boxes.forEach(function (box) {
      if (box.x < minX) minX = box.x;
      if (box.y < minY) minY = box.y;
      if (box.x + box.w > maxX) maxX = box.x + box.w;
      if (box.y + box.h > maxY) maxY = box.y + box.h;
    });
    // 留白：四周至少 40px，另外给悬停标题留出上方空间。
    var viewWidth = Math.max(120, root.clientWidth - 96);
    var viewHeight = Math.max(120, root.clientHeight - 120);
    var spanX = Math.max(40, maxX - minX);
    var spanY = Math.max(40, maxY - minY);
    var zoom = Math.max(0.06, Math.min(1.8, Math.min(viewWidth / spanX, viewHeight / spanY)));
    var target = {
      x: root.clientWidth / 2 - ((minX + maxX) / 2) * zoom,
      y: root.clientHeight / 2 - ((minY + maxY) / 2) * zoom,
      zoom: zoom
    };
    // 首次绘制瞬移，之后缓动（250ms ease-out），切聚焦时镜头不会闪。
    var ease = options !== undefined && options !== null && options.ease === true;
    mindMapCameraTouched = false;
    if (ease) animateCameraTo(target, 250);
    else {
      cameraRef.current = target;
      writeGraphCamera(target);
      schedule();
    }
  };

  /** 把一个点平移到视口正中：云图模式下的"跳转"。 */
  var centerOnCard = function (cardId, options) {
    var root = rootRef.current;
    var camera = cameraRef.current;
    if (root === null || camera === null) return false;
    var box = dotBoxes().get(cardId);
    if (box === void 0) return false;
    // 跳过去是为了看清它和它的邻居：比 1 还远就先拉到 1.1，本来就更近则保留。
    var requested = options !== undefined && options !== null && typeof options.zoom === "number" ? options.zoom : camera.zoom;
    var zoom = Math.max(1.05, Math.min(2, requested));
    animateCameraTo({
      x: root.clientWidth / 2 - box.cx * zoom,
      y: root.clientHeight / 2 - box.cy * zoom,
      zoom: zoom
    }, 320);
    return true;
  };

  drawRef.current = function () {
    mindMapDrawCount += 1;
    var root = rootRef.current;
    var canvas = canvasRef.current;
    if (root === null || canvas === null) return;
    var width = root.clientWidth;
    var height = root.clientHeight;
    if (width < 4 || height < 4) return;
    // 面板刚打开（或刚挂回侧栏）：先按当前内容做一次初始 fit，避免用户面对
    // 一个偏到屏幕外 / 留白过大的旧镜头。刚打开的 8 秒内每 150ms（或尺寸变了）
    // 重算一次：布局在收敛、右栏展开动画也在改尺寸，首帧的 fit 一定不准。
    if (mindMapPendingFit.until > Date.now()) {
      var fitNow = Date.now();
      var sizeChanged = Math.abs(mindMapPendingFit.width - width) > 8 || Math.abs(mindMapPendingFit.height - height) > 8;
      if (sizeChanged || fitNow - mindMapPendingFit.last >= 150) {
        mindMapPendingFit.last = fitNow;
        mindMapPendingFit.width = width;
        mindMapPendingFit.height = height;
        fitRef.current({ ease: false });
      }
    }
    if (cameraRef.current === null) {
      fitRef.current();
      return;
    }
    var dpr = window.devicePixelRatio || 1;
    var pixelWidth = Math.round(width * dpr);
    var pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
    }
    var context = canvas.getContext("2d");
    if (context === null) return;
    var camera = cameraRef.current;
    var zoom = camera.zoom;
    var now = typeof performance !== "undefined" ? performance.now() : Date.now();
    var dark = propsRef.current.colorMode !== "light";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = dark ? "#14161b" : "#fbfbfd";
    context.fillRect(0, 0, width, height);

    var degrees = linkDegrees();
    var boxes = dotBoxes();
    var nodes = visibleNodes();
    // 点选住的关键词优先于指针悬停：鼠标移开之后它的整簇还亮着。
    var picked = pickedRef.current;
    var hovered = hoverRef.current !== null ? hoverRef.current : picked;
    // 聚焦（spotlight）：非 null 表示聚焦开着，只点亮这一个点。
    var focusAnchor = propsRef.current.focusAnchorId === void 0 ? null : propsRef.current.focusAnchorId;
    var spotlightOn = focusAnchor !== null && focusAnchor !== void 0;
    // 浏览关键词时临时显示整簇；结束后恢复现有会话聚焦，不改变聚焦开关。
    for (var tagFocusIndex = 0; tagFocusIndex < nodes.length; tagFocusIndex += 1) {
      if (nodes[tagFocusIndex].id === hovered && nodes[tagFocusIndex].type === "tagNode") {
        spotlightOn = false;
        break;
      }
    }
    var edges = propsRef.current.edges || [];

    // 悬停时的邻居集合：只有直接相连的点保持明亮，其余压暗。
    var neighbours = null;
    if (hovered !== null) {
      neighbours = new Set();
      for (var probeIndex = 0; probeIndex < edges.length; probeIndex += 1) {
        var probe = edges[probeIndex];
        if (probe.source === hovered) neighbours.add(probe.target);
        else if (probe.target === hovered) neighbours.add(probe.source);
      }
    }

    // ws = 同一个工作区（冷灰），tag = 同一个标签（蓝），lineage = 子代理/血缘（暖橙）。
    var edgePalette = {
      ws: dark ? "rgba(154,168,192,0.34)" : "rgba(70,85,105,0.28)",
      tag: dark ? "rgba(122,166,232,0.28)" : "rgba(40,110,200,0.24)",
      lineage: dark ? "rgba(255,206,120,0.5)" : "rgba(190,130,30,0.42)",
      other: dark ? "rgba(198,206,220,0.26)" : "rgba(40,48,60,0.22)"
    };

    context.save();
    context.translate(camera.x, camera.y);
    context.scale(zoom, zoom);
    context.lineCap = "round";

    // ---- 连线 ----------------------------------------------------------
    for (var edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      var edge = edges[edgeIndex];
      var fromBox = boxes.get(edge.source);
      var toBox = boxes.get(edge.target);
      if (fromBox === void 0 || toBox === void 0) continue;
      var deltaX = toBox.cx - fromBox.cx;
      var deltaY = toBox.cy - fromBox.cy;
      var distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance < 0.001) continue;
      var unitX = deltaX / distance;
      var unitY = deltaY / distance;
      var kind = edge.data !== void 0 && edge.data.graphKind !== void 0 ? edge.data.graphKind : (edge.type === "mindMap" ? "lineage" : "other");
      var touchesHover = hovered !== null && (edge.source === hovered || edge.target === hovered);
      var touchesFocus = spotlightOn && (edge.source === focusAnchor || edge.target === focusAnchor);
      if (spotlightOn) context.globalAlpha = touchesFocus ? 0.95 : (touchesHover ? 0.9 : 0.07);
      else if (hovered !== null) context.globalAlpha = touchesHover ? 1 : 0.12;
      else context.globalAlpha = 1;
      context.strokeStyle = edgePalette[kind] === void 0 ? edgePalette.other : edgePalette[kind];
      // 屏幕上恒定的细线：放大时不会变成粗绳，缩小时也不会消失。
      context.lineWidth = (touchesHover ? 1.6 : 0.85) / zoom;
      // 线从两个圆的边界开始，不穿过圆点本身（半径上限和点的绘制保持一致，
      // 否则放大到极限时线会在点外面留一截空隙）。
      var fromEdge = Math.min(fromBox.r, 24 / zoom);
      var toEdge = Math.min(toBox.r, 24 / zoom);
      context.beginPath();
      context.moveTo(fromBox.cx + unitX * fromEdge, fromBox.cy + unitY * fromEdge);
      context.lineTo(toBox.cx - unitX * toEdge, toBox.cy - unitY * toEdge);
      context.stroke();
    }
    context.globalAlpha = 1;

    // ---- 点 ------------------------------------------------------------
    for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      var node = nodes[nodeIndex];
      var box = boxes.get(node.id);
      if (box === void 0) continue;
      var data = node.data || {};
      var isTag = data.tagNode === true;
      var isPicked = picked !== null && picked === node.id;
      var archived = data.archived === true;
      // 子代理跑完和归档一样灰化。
      var isSubagent = data.subagent === true;
      var subagentDone = isSubagent && data.subagentFinished === true;
      var dormant = archived || subagentDone;
      var isCurrent = data.current === true;
      var isRunning = data.running === true || data.glow === "running";
      var isWaiting = data.waiting === true;
      var isDone = data.done === true;
      var isHovered = hovered === node.id;
      var isSpotlight = spotlightOn && node.id === focusAnchor;
      var isSpotDim = spotlightOn && !isSpotlight;
      var nearHover = hovered === null || isHovered || (neighbours !== null && neighbours.has(node.id));
      var alpha;
      if (isSpotlight) alpha = 1;
      else if (dormant) alpha = isSpotDim ? 0.2 : 0.38;
      else if (spotlightOn) alpha = isHovered ? 0.9 : 0.22;
      else if (hovered === null) alpha = 1;
      else alpha = nearHover ? 1 : 0.3;

      // 缓慢闪烁：正在跑的会话外面套一层呼吸的光晕（周期约 3 秒，不是快闪）。
      // 画成"软盘 + 细环"两层，缩到很远时是一颗亮一点的星，放到很大时是一圈光。
      var drawRadius = Math.min(box.r, 24 / zoom);
      if (isRunning && alpha > 0.5) {
        var pulse = 0.5 + 0.5 * Math.sin(now / 480);
        context.save();
        context.globalAlpha = alpha * (0.10 + 0.16 * pulse);
        context.fillStyle = dark ? "#ffffff" : "#1b1e25";
        context.beginPath();
        context.arc(box.cx, box.cy, drawRadius + 3 + 5 * pulse, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = alpha * (0.24 + 0.3 * pulse);
        context.strokeStyle = dark ? "#ffffff" : "#1b1e25";
        context.lineWidth = 1.2 / zoom;
        context.beginPath();
        context.arc(box.cx, box.cy, drawRadius + 3 + 5 * pulse, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(box.cx, box.cy, drawRadius, 0, Math.PI * 2);
      if (isTag) {
        // 关键词点画成「空心环」：一眼能把它和会话点区分开，
        // 但大小规则一样（用它的会话越多，这个 key 越大）。
        context.fillStyle = dark ? "rgba(18,22,31,0.92)" : "rgba(255,255,255,0.96)";
        context.fill();
        context.strokeStyle = dark ? "rgba(126,178,248,0.95)" : "rgba(38,106,196,0.9)";
        context.lineWidth = 1.7 / zoom;
        context.stroke();
      } else {
        if (isRunning) context.fillStyle = dark ? "#ffffff" : "#1b1e25";
        else if (isWaiting) context.fillStyle = "#f5b22e";
        else if (isDone) context.fillStyle = "#34c759";
        else context.fillStyle = dark ? "rgba(206,214,228,0.86)" : "rgba(64,72,86,0.72)";
        context.fill();
      }

      // 高亮环：当前会话 = 琥珀（和状态栏一致），聚焦锚点 = 琥珀，悬停 = 蓝。
      if (!isTag && (isCurrent || isSpotlight || isHovered)) {
        context.globalAlpha = alpha;
        context.strokeStyle = isHovered && !isCurrent && !isSpotlight ? "#8ab4ff" : "#ffd66a";
        context.lineWidth = (isHovered ? 1.8 : 1.4) / zoom;
        context.beginPath();
        context.arc(box.cx, box.cy, drawRadius + Math.max(1.5, 2.6 / zoom), 0, Math.PI * 2);
        context.stroke();
      } else if (isTag && (isHovered || isPicked)) {
        // 悬停 / 点选中的关键词：外面再套一圈亮蓝，让它和它的会话都跳出来。
        context.globalAlpha = alpha;
        context.strokeStyle = "rgba(150,196,255,0.9)";
        context.lineWidth = 1.6 / zoom;
        context.beginPath();
        context.arc(box.cx, box.cy, drawRadius + Math.max(2, 3 / zoom), 0, Math.PI * 2);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    context.restore();

    // ---- 悬停标题（屏幕空间，所以任何缩放下都是同一个字号） -------------
    var showId = hovered !== null ? hovered : (spotlightOn ? focusAnchor : null);
    if (showId !== null && showId !== void 0) {
      var showBox = boxes.get(showId);
      var showNode = null;
      for (var findIndex = 0; findIndex < nodes.length; findIndex += 1) if (nodes[findIndex].id === showId) showNode = nodes[findIndex];
      if (showBox !== void 0 && showNode !== null) {
        var showData = showNode.data || {};
        var title;
        if (showData.tagNode === true) {
          // 关键词点：让人一眼看出它是什么、被几个会话用到。
          title = "#" + String(showData.tag === void 0 ? "" : showData.tag);
          if (typeof showData.count === "number" && showData.count > 0) title = title + "  ·  " + showData.count + " 个会话";
        } else {
          title = showData.title === void 0 || String(showData.title) === "" ? "未命名会话" : String(showData.title);
        }
        context.font = "600 12.5px " + GRAPH_FONT_STACK;
        var maxTextWidth = Math.max(60, Math.min(DOT_LABEL_MAX_W, width - 28));
        var label = graphEllipsis(context, title, maxTextWidth);
        var textWidth = context.measureText(label).width;
        var padX = 9;
        var boxW = Math.ceil(textWidth) + padX * 2;
        var boxH = 24;
        var screenX = camera.x + showBox.cx * zoom;
        var screenY = camera.y + showBox.cy * zoom;
        var pointerRadius = Math.max(2, showBox.r * zoom);
        var labelX = Math.round(screenX - boxW / 2);
        var labelY = Math.round(screenY - pointerRadius - 9 - boxH);
        if (labelY < 6) labelY = Math.round(screenY + pointerRadius + 9);
        labelX = Math.max(6, Math.min(width - boxW - 6, labelX));
        labelY = Math.max(6, Math.min(height - boxH - 6, labelY));
        context.globalAlpha = 1;
        graphRoundRect(context, labelX, labelY, boxW, boxH, 7);
        context.fillStyle = dark ? "rgba(22,24,30,0.94)" : "rgba(255,255,255,0.97)";
        context.fill();
        context.strokeStyle = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = dark ? "#e9ebf1" : "#1b1e25";
        context.textBaseline = "middle";
        context.fillText(label, labelX + padX, labelY + boxH / 2 + 0.5);
        context.textBaseline = "alphabetic";
      }
    }

    // ---- 拉线分叉的橡皮筋 ----------------------------------------------
    var fork = forkRef.current;
    if (fork !== null) {
      var forkBox = boxes.get(fork.id);
      if (forkBox !== void 0) {
        context.save();
        context.translate(camera.x, camera.y);
        context.scale(zoom, zoom);
        context.setLineDash([6 / zoom, 5 / zoom]);
        context.lineWidth = 2 / zoom;
        context.strokeStyle = "rgba(120,180,255,0.92)";
        context.beginPath();
        context.moveTo(forkBox.cx, forkBox.cy);
        context.lineTo(fork.flowX, fork.flowY);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.arc(fork.flowX, fork.flowY, 4 / zoom, 0, Math.PI * 2);
        context.fillStyle = "rgba(120,180,255,0.92)";
        context.fill();
        context.restore();
      }
    }
  };

  var emitNodeChange = function (id, position, dragging) {
    var handler = propsRef.current.onNodesChange;
    if (typeof handler !== "function") return;
    handler([{ id: id, type: "position", position: position, dragging: dragging }]);
  };

  /** 命中最靠近指针的点；命中半径在屏幕上至少 8px，缩到很远也点得到。 */
  var hitTest = function (flowX, flowY) {
    var camera = cameraRef.current;
    var boxes = dotBoxes();
    var nodes = visibleNodes();
    var best = null;
    var bestDistance = Infinity;
    for (var index = 0; index < nodes.length; index += 1) {
      var box = boxes.get(nodes[index].id);
      if (box === void 0) continue;
      var deltaX = flowX - box.cx;
      var deltaY = flowY - box.cy;
      var distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      var pad = Math.max(box.r + 4, 8 / (camera === null ? 1 : camera.zoom));
      if (distance > pad) continue;
      if (distance < bestDistance) { bestDistance = distance; best = nodes[index]; }
    }
    return best;
  };

  var toFlow = function (clientX, clientY) {
    var root = rootRef.current;
    var camera = cameraRef.current;
    if (root === null || camera === null) return { x: 0, y: 0 };
    var rect = root.getBoundingClientRect();
    return { x: (clientX - rect.left - camera.x) / camera.zoom, y: (clientY - rect.top - camera.y) / camera.zoom };
  };

  var onPointerDown = function (event) {
    if (event.button !== 0) return;
    if (event.target !== null && typeof event.target.closest === "function" && event.target.closest(".tm_canvasCtl") !== null) return;
    var root = rootRef.current;
    if (root === null) return;
    var flow = toFlow(event.clientX, event.clientY);
    var hit = hitTest(flow.x, flow.y);
    hoverRef.current = hit === null ? null : hit.id;
    if (root.setPointerCapture !== void 0) {
      try { root.setPointerCapture(event.pointerId); } catch (error) { }
    }
    if (hit === null) {
      // 点空白处 = 取消"钉住的关键词"。
      if (pickedRef.current !== null) { pickedRef.current = null; schedule(); }
      mindMapCameraTouched = true;
      dragRef.current = { kind: "pan", startClientX: event.clientX, startClientY: event.clientY, cameraX: cameraRef.current.x, cameraY: cameraRef.current.y, moved: false, preview: null };
    } else if (hit.type === "tagNode") {
      // 关键词点不可拖动（它的坐标是派生的）：按下只准备一次"点选"。
      dragRef.current = { kind: "tagtap", id: hit.id, startClientX: event.clientX, startClientY: event.clientY, moved: false, preview: null };
      schedule();
    } else if (event.shiftKey === true) {
      // shift + 从一个点拖出去 = 分叉手势：不移动这个点，只画一根橡皮筋。
      dragRef.current = { kind: "fork", id: hit.id, startClientX: event.clientX, startClientY: event.clientY, moved: false, preview: null };
      forkRef.current = { id: hit.id, flowX: flow.x, flowY: flow.y };
    } else {
      var hitBox = dotBoxes().get(hit.id);
      var origin = hitBox === void 0 ? hit.position : { x: hitBox.cx, y: hitBox.cy };
      // hitTest 和拖动必须使用同一套实时坐标，不能从模拟位置跳回旧 store 位置。
      dragRef.current = { kind: "node", id: hit.id, origin: origin, offsetX: flow.x - origin.x, offsetY: flow.y - origin.y, startClientX: event.clientX, startClientY: event.clientY, moved: false, preview: origin };
      reheat(0.8);
      emitNodeChange(hit.id, origin, true);
    }
    event.preventDefault();
  };

  var onPointerMove = function (event) {
    var drag = dragRef.current;
    if (drag === null) {
      var hoverFlow = toFlow(event.clientX, event.clientY);
      var hoverNode = hitTest(hoverFlow.x, hoverFlow.y);
      var hoverId = hoverNode === null ? null : hoverNode.id;
      if (hoverId !== hoverRef.current) {
        hoverRef.current = hoverId;
        schedule();
      }
      return;
    }
    var deltaX = event.clientX - drag.startClientX;
    var deltaY = event.clientY - drag.startClientY;
    if (drag.kind === "fork") {
      if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) > 6) drag.moved = true;
      var forkPoint = toFlow(event.clientX, event.clientY);
      if (forkRef.current !== null) {
        forkRef.current.flowX = forkPoint.x;
        forkRef.current.flowY = forkPoint.y;
      }
      schedule();
      return;
    }
    if (drag.kind === "tagtap") {
      if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) > 6) drag.moved = true;
      return;
    }
    if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) > 6) {
      drag.moved = true;
      if (drag.kind === "node") emitNodeChange(drag.id, drag.preview === null ? drag.origin : drag.preview, true);
    }
    if (drag.kind === "pan") {
      cameraRef.current = { x: drag.cameraX + deltaX, y: drag.cameraY + deltaY, zoom: cameraRef.current.zoom };
      writeGraphCamera(cameraRef.current);
    } else {
      var flow = toFlow(event.clientX, event.clientY);
      var position = { x: Math.round(flow.x - drag.offsetX), y: Math.round(flow.y - drag.offsetY) };
      drag.preview = position;
      // 按住期间把热值兜住，否则 300ms 后整块就不再流动了。
      var sim = simRef.current;
      if (sim !== null && sim.alpha < 0.4) sim.alpha = 0.4;
      if (drag.moved) emitNodeChange(drag.id, position, true);
    }
    schedule();
  };

  var onPointerUp = function (event) {
    var drag = dragRef.current;
    dragRef.current = null;
    if (drag === null) return;
    if (drag.kind === "fork") {
      var fork = forkRef.current;
      forkRef.current = null;
      if (drag.moved && fork !== null) {
        var forkPoint = toFlow(event.clientX, event.clientY);
        var bridge = mindMapCanvasBridge.current;
        var landed = hitTest(forkPoint.x, forkPoint.y);
        if (bridge !== null && landed === null && typeof bridge.forkFrom === "function") bridge.forkFrom(drag.id, forkPoint.x, forkPoint.y);
      }
      schedule();
      return;
    }
    if (drag.kind === "tagtap") {
      if (!drag.moved) {
        pickedRef.current = pickedRef.current === drag.id ? null : drag.id;
        schedule();
      }
      return;
    }
    if (drag.kind === "node") {
      if (drag.moved) {
        var position = drag.preview !== null ? drag.preview : drag.origin;
        emitNodeChange(drag.id, position, false);
        // 松手后把板子还给模拟：邻居还偏离平衡，让它们自己找回去。
        reheat(0.55);
      } else {
        // 纯点击：关键词点 = 钉住/取消钉住（高亮它和它的会话）；
        // 会话点交给插件自己的节点点击处理（它知道什么时候该打开会话）。
        var node = null;
        var nodes = propsRef.current.nodes || [];
        for (var index = 0; index < nodes.length; index += 1) if (nodes[index].id === drag.id) node = nodes[index];
        if (node !== null && node.type === "tagNode") {
          pickedRef.current = pickedRef.current === node.id ? null : node.id;
          schedule();
        } else if (node !== null && typeof propsRef.current.onNodeClick === "function") {
          propsRef.current.onNodeClick(event, node);
        }
      }
    } else {
      var handler = propsRef.current.onMoveEnd;
      if (typeof handler === "function") handler(null, cameraRef.current);
    }
    schedule();
  };

  var zoomBy = function (factor) {
    var root = rootRef.current;
    var camera = cameraRef.current;
    if (root === null || camera === null) return;
    var centerX = root.clientWidth / 2;
    var centerY = root.clientHeight / 2;
    var zoom = Math.max(0.05, Math.min(2.6, camera.zoom * factor));
    var ratio = zoom / camera.zoom;
    cameraRef.current = { x: centerX - (centerX - camera.x) * ratio, y: centerY - (centerY - camera.y) * ratio, zoom: zoom };
    writeGraphCamera(cameraRef.current);
    schedule();
  };

  react.useEffect(function () {
    var root = rootRef.current;
    if (root === null) return;
    var observer = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(function () { schedule(); });
      observer.observe(root);
    }
    // React 把 wheel 监听挂成 passive，preventDefault() 会抛；这里挂原生非 passive 的。
    var wheelHandler = function (event) {
      mindMapCameraTouched = true;
      event.preventDefault();
      var target = rootRef.current;
      var camera = cameraRef.current;
      if (target === null || camera === null) return;
      var rect = target.getBoundingClientRect();
      var pointerX = event.clientX - rect.left;
      var pointerY = event.clientY - rect.top;
      var factor = Math.exp(-event.deltaY * 0.0015);
      var zoom = Math.max(0.05, Math.min(2.6, camera.zoom * factor));
      var ratio = zoom / camera.zoom;
      cameraRef.current = { x: pointerX - (pointerX - camera.x) * ratio, y: pointerY - (pointerY - camera.y) * ratio, zoom: zoom };
      writeGraphCamera(cameraRef.current);
      schedule();
    };
    root.addEventListener("wheel", wheelHandler, { passive: false });
    // 一个 rAF 干三件事，按优先级：推进模拟 → 推进镜头补间 → 只在有会话在跑
    // （或悬停在点上）时重绘。空闲的图因此是零开销的。
    var animationFrame = 0;
    var animationTick = 0;
    var animate = function () {
      animationFrame = window.requestAnimationFrame(animate);
      // 宿主被摘下（全屏接管 / 正在换会话）时不跑模拟也不画。
      if (root.isConnected !== true) return;
      // 自动取景守卫：每 400ms 看一次内容是否出界或留白过大，用户没亲手拖过
      // 镜头就重新 fit —— 面板尺寸变化、布局收敛、切聚焦都会自愈。
      if (mindMapCameraTouched !== true && Date.now() - mindMapAutoFitAt >= 400) {
        mindMapAutoFitAt = Date.now();
        var autoRoot = rootRef.current;
        if (autoRoot !== null && autoRoot.clientWidth >= 40 && autoRoot.clientHeight >= 40) {
          var autoCam = cameraRef.current;
          if (autoCam !== null) {
            var autoBoxes = dotBoxes();
            if (autoBoxes.size > 0) {
              var autoMinX = Infinity;
              var autoMinY = Infinity;
              var autoMaxX = -Infinity;
              var autoMaxY = -Infinity;
              autoBoxes.forEach(function (autoBox) {
                if (autoBox.x < autoMinX) autoMinX = autoBox.x;
                if (autoBox.y < autoMinY) autoMinY = autoBox.y;
                if (autoBox.x + autoBox.w > autoMaxX) autoMaxX = autoBox.x + autoBox.w;
                if (autoBox.y + autoBox.h > autoMaxY) autoMaxY = autoBox.y + autoBox.h;
              });
              if (autoMaxX > autoMinX) {
                var autoScrMinX = autoCam.x + autoMinX * autoCam.zoom;
                var autoScrMaxX = autoCam.x + autoMaxX * autoCam.zoom;
                var autoScrMinY = autoCam.y + autoMinY * autoCam.zoom;
                var autoScrMaxY = autoCam.y + autoMaxY * autoCam.zoom;
                var autoOverflow = autoScrMinX < 6 || autoScrMinY < 6 || autoScrMaxX > autoRoot.clientWidth - 6 || autoScrMaxY > autoRoot.clientHeight - 6;
                var autoTooSmall = autoScrMaxX - autoScrMinX < autoRoot.clientWidth * 0.55 && autoScrMaxY - autoScrMinY < autoRoot.clientHeight * 0.55;
                if (autoOverflow || autoTooSmall) fitRef.current({ ease: true });
              }
            }
          }
        }
      }
      animationTick += 1;
      var now = typeof performance !== "undefined" ? performance.now() : Date.now();
      var sim = simRef.current;
      var simRunning = sim !== null && sim.alpha > simSettings.alphaMin;
      if (simRunning) tickSim();
      var tweening = stepTween(now);
      if (simRunning || tweening) {
        drawRef.current();
        if (simRunning && simRef.current !== null && simRef.current.alpha <= simSettings.alphaMin) commitSim();
        return;
      }
      // 空闲：只有「有会话在跑」或者「鼠标停在某个点上」才继续出帧
      // （闪烁的光晕 + 悬停标题不需要每帧重算布局，但需要重绘）。
      if (animationTick % 2 !== 0) return;
      var nodes = propsRef.current.nodes || [];
      for (var index = 0; index < nodes.length; index += 1) {
        var node = nodes[index];
        if (node.hidden !== true && node.data !== void 0 && (node.data.running === true || node.data.glow === "running")) {
          drawRef.current();
          return;
        }
      }
    };
    // 这里故意不调用 ensureSim：触发这次渲染的 store 写入可能还没反映到
    // props，用旧 props 重播种会把新布局扔掉。下一帧 tick 会自己重新播种。
    var offLive = mindMapLive.subscribe(function () { schedule(); });
    mindMapFitKick.fn = function () { pendingFitRef.current = true; reheat(1); schedule(); };
    mindMapSimKick.fn = function (heat) {
      reseedRef.current = true;
      discSeedRef.current = true;
      var sim = simRef.current;
      if (sim === null) { sim = { nodes: new Map(), alpha: 0 }; simRef.current = sim; }
      sim.alpha = heat === void 0 ? 1 : heat;
      schedule();
    };
    mindMapCanvasToFlow.fn = function (clientX, clientY) { return toFlow(clientX, clientY); };
    mindMapCenterKick.fn = centerOnCard;
    // 只读探针，给验证脚本用（alpha、点数、已落库坐标、当前帧的点/边）。
    window.__mindMapDebug = {
      alpha: function () { var sim = simRef.current; return sim === null ? null : sim.alpha; },
      size: function () { var sim = simRef.current; return sim === null ? 0 : sim.nodes.size; },
      nodes: function () { var sim = simRef.current; var out = {}; if (sim !== null) sim.nodes.forEach(function (value, key) { out[key] = { x: Math.round(value.x), y: Math.round(value.y), vx: value.vx, vy: value.vy }; }); return out; },
      reheat: function () { reheat(1); },
      draws: function () { return mindMapDrawCount; },
      // 当前这一帧：每个点的位置 / 半径 / 度数，以及聚焦锚点。
      dots: function () {
        var degrees = linkDegrees();
        var boxes = dotBoxes();
        var kinds = new Map();
        var nodes = visibleNodes();
        for (var index = 0; index < nodes.length; index += 1) kinds.set(nodes[index].id, nodes[index].type);
        var out = [];
        boxes.forEach(function (box, id) {
          out.push({ id: id, kind: kinds.get(id) || null, x: Math.round(box.cx), y: Math.round(box.cy), r: Math.round(box.r * 100) / 100, degree: degrees.get(id) || 0 });
        });
        return out;
      },
      overlaps: function () {
        // 验证「不要重合」：返回圆心距 < rA + rB 的对数（硬芯应该让它保持 0）。
        var degrees = linkDegrees();
        var boxes = dotBoxes();
        var list = [];
        boxes.forEach(function (box, id) { list.push({ id: id, box: box }); });
        var hits = [];
        for (var left = 0; left < list.length; left += 1) {
          for (var right = left + 1; right < list.length; right += 1) {
            var dx = list[left].box.cx - list[right].box.cx;
            var dy = list[left].box.cy - list[right].box.cy;
            if (Math.sqrt(dx * dx + dy * dy) < list[left].box.r + list[right].box.r) hits.push([list[left].id, list[right].id]);
          }
        }
        return hits;
      },
      graph: function () {
        var nodes = propsRef.current.nodes || [];
        var edges = propsRef.current.edges || [];
        return {
          focusAnchorId: propsRef.current.focusAnchorId === void 0 ? null : propsRef.current.focusAnchorId,
          nodes: nodes.map(function (node) {
            return {
              id: node.id,
              type: node.type,
              hidden: node.hidden === true,
              title: node.data !== void 0 ? node.data.title : null,
              sessionId: node.data !== void 0 && node.data.sessionId !== void 0 ? node.data.sessionId : null,
              current: node.data !== void 0 && node.data.current === true,
              running: node.data !== void 0 && node.data.running === true,
              subagent: node.data !== void 0 && node.data.subagent === true,
              subagentFinished: node.data !== void 0 && node.data.subagentFinished === true
            };
          }),
          edges: edges.map(function (edge) {
            return {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              kind: edge.data !== void 0 && edge.data.graphKind !== void 0 ? edge.data.graphKind : (edge.type === "mindMap" ? "lineage" : "other")
            };
          })
        };
      },
      camera: function () { var camera = cameraRef.current; return camera === null ? null : { x: camera.x, y: camera.y, zoom: camera.zoom }; },
      viewport: function () { var root = rootRef.current; return root === null ? null : { width: root.clientWidth, height: root.clientHeight }; },
      box: function (cardId) { var box = dotBoxes().get(cardId); return box === void 0 ? null : { x: box.x, y: box.y, w: box.w, h: box.h, r: box.r, cx: box.cx, cy: box.cy }; },
      centerOn: function (cardId, zoom) { return centerOnCard(cardId, { zoom: zoom }); },
      tweening: function () { return tweenRef.current !== null; },
      // 现场调参：在控制台改 __mindMapDebug.settings.velocityDecay = 0.55 立刻生效。
      settings: simSettings
    };
    animationFrame = window.requestAnimationFrame(animate);
    if (cameraRef.current === null) fitRef.current();
    schedule();
    return function () {
      root.removeEventListener("wheel", wheelHandler);
      if (typeof offLive === "function") offLive();
      mindMapSimKick.fn = null;
      mindMapFitKick.fn = null;
      mindMapCanvasToFlow.fn = null;
      mindMapCenterKick.fn = null;
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      if (observer !== null) observer.disconnect();
      if (frameRef.current !== 0) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, []);

  var signatureRef = react.useRef("");
  var laidSignatureRef = react.useRef("");
  react.useEffect(function () {
    var nodes = props.nodes || [];
    var ids = [];
    for (var index = 0; index < nodes.length; index += 1) if (nodes[index].hidden !== true) ids.push(nodes[index].id);
    ids.sort();
    var signature = ids.join(",");
    var laidSignature = "";
    try { laidSignature = window.localStorage.getItem(MIND_MAP_LAID_SIG_KEY) || ""; } catch (error) { laidSignature = ""; }
    if (laidSignature.indexOf(CLOUD_LAYOUT_TAG) === 0) laidSignature = laidSignature.slice(CLOUD_LAYOUT_TAG.length);
    else laidSignature = "";
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      laidSignatureRef.current = signature;
      if (signature !== laidSignature) {
        // 换了一批点（切聚焦 / 新会话进来）：重新播种、加热、缓动到新范围。
        simRef.current = null;
        discSeedRef.current = laidSignature === "";
        reheat(1);
        fitRef.current({ ease: cameraRef.current !== null });
      } else {
        // 成员和上次收敛时一样：只可能是面板重挂，不重排也不动镜头 ——
        // 但还是要给模拟一点热值把"不要重合"重新压实（存下来的坐标可能来自
        // 旧的白板布局 / 更早的一次退化布局），不然它永远不会自愈。
        reheat(0.45);
        schedule();
      }
    } else {
      schedule();
    }
  }, [props.nodes, props.edges, props.colorMode]);

  return (0, import_jsx_runtime16.jsxs)("div", {
    className: "tm_graphSurface",
    ref: rootRef,
    onPointerDown: onPointerDown,
    onPointerMove: onPointerMove,
    onPointerUp: onPointerUp,
    onPointerCancel: onPointerUp,
    onPointerLeave: function () {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        schedule();
      }
    },
    onDoubleClick: function (event) {
      event.stopPropagation();
      var flow = toFlow(event.clientX, event.clientY);
      var bridge = mindMapCanvasBridge.current;
      if (bridge !== null && hitTest(flow.x, flow.y) === null && typeof bridge.startSessionAt === "function") bridge.startSessionAt(flow.x, flow.y);
    },
    onContextMenu: function (event) {
      event.preventDefault();
      var bridge = mindMapCanvasBridge.current;
      if (bridge === null) return;
      var flow = toFlow(event.clientX, event.clientY);
      var node = hitTest(flow.x, flow.y);
      var fake = { clientX: event.clientX, clientY: event.clientY, preventDefault: function () { }, stopPropagation: function () { } };
      if (node === null) { if (typeof bridge.openPaneMenu === "function") bridge.openPaneMenu(fake); }
      else if (node.type === "tagNode") { if (typeof bridge.openPaneMenu === "function") bridge.openPaneMenu(fake); }
      else if (typeof bridge.openCardMenu === "function") bridge.openCardMenu(fake, node.id);
    },
    children: [
      (0, import_jsx_runtime16.jsx)("canvas", { ref: canvasRef, className: "tm_graphCanvas" }),
      (0, import_jsx_runtime16.jsxs)("div", { className: "tm_canvasCtl", children: [
        (0, import_jsx_runtime16.jsx)("button", { type: "button", title: "放大", onClick: function () { zoomBy(1.25); }, children: "+" }),
        (0, import_jsx_runtime16.jsx)("button", { type: "button", title: "缩小", onClick: function () { zoomBy(0.8); }, children: "−" }),
        (0, import_jsx_runtime16.jsx)("button", { type: "button", title: "适配视图", onClick: function () { fitRef.current(); }, children: "⤢" })
      ] })
    ]
  });
}
