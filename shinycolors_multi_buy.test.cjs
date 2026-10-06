'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(`${__dirname}/shinycolors_multi_buy.user.js`, 'utf8');
function setup(confirm = true, config = {}) {
  const nodes = [];
  class Element {
    constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.events = {}; nodes.push(this); }
    append(n) { this.children.push(n); n.isConnected = true; }
    addEventListener(t, fn) { this.events[t] = fn; }
    setAttribute() {}
    querySelectorAll() { return []; }
    remove() { this.removed = true; }
  }
  const items = config.items || [1, 2].map(id => ({ id: String(id), title: `商品${id}`, currency: 'money', price: 100,
    getRestOfPurchaseCount: () => 10, calcPurchasableCountWithinPossessionNumLimit: () => 5 }));
  const calls = [], callbacks = [], alerts = [], timers = new Map(), delays = new Map(), dialogs = [];
  let timerId = 0;
  const scene = { _currentCategory: config.category || 'money', interactiveChildren: true,
    _dialogLayer: { children: [] }, _shopContents: config.contents || { merchandises: items.map(m => ({ shopMerchandiseId: m.id })) },
    _shopStore: { userWallet: config.wallet || { money: 1000 }, userShops: [{ category: config.category || 'money', shopMerchandises: items }], findShopMerchandise: id => items.find(m => m.id === id), getUserShopFromShopMerchandise: () => ({ category: config.ownerCategory || config.category || 'money' }) },
    _onSubmitPurchase(m, count, cb) { calls.push([m.id, count]); cb(m, count, [], null, false); },
    _onPurchased(m, count, missions, close) {
      scene._shopStore.userWallet[m.walletKey || 'money'] -= m.price * count;
      scene._dialogLayer.showResult({ shopMerchandise: m, onClose: close || (() => scene._updateMerchandiseList(m.id)) });
    },
    _onTraded(m, count) {
      for (const r of m.tradeShopRequirements) scene._shopStore.userWallet[r.getWalletKey()] -= r.num * count;
      scene._dialogLayer.showTradeResult({ shopMerchandise: m, onClose: () => scene._updateMerchandiseList(m.id) });
    },
    _onIdolEvolutionPiecePurchased(m, count) { scene._onPurchased(m, count); scene.pieceUpdated = true; },
    _updateMerchandiseList() { scene.updateCalls = (scene.updateCalls || 0) + 1; } };
  const showResult = ({ onClose }) => {
      const dialog = new EventEmitter();
      dialog.closeCalls = 0;
      dialog.close = () => { dialog.closeCalls++; dialog.emit('closeStart'); };
      dialog.finishClose = () => {
        dialog.emit('closeEnd');
        onClose();
        dialog._destroyed = true;
        scene._dialogLayer.children = scene._dialogLayer.children.filter(d => d !== dialog);
      };
      scene._dialogLayer.children.push(dialog);
      dialogs.push(dialog);
      callbacks.push(dialog.finishClose);
  };
  scene._dialogLayer.showResult = showResult;
  scene._dialogLayer.showTradeResult = showResult;
  let confirmCalls = 0;
  const chunks = config.deferChunks ? [] : [[[], { 4748: () => {} }]];
  let engineLoads = 0;
  chunks.push = chunk => chunk[2](() => { engineLoads++; return { sceneManager: { currentScene: scene } }; });
  const window = { confirm: () => { confirmCalls++; config.onConfirm?.(scene); return confirm; }, alert: s => alerts.push(s), [config.chunkName || 'unedyavedad0as']: chunks, unrelatedChunks: [[[], { 123: () => {} }]] };
  Object.defineProperty(window, 'unreadableGlobal', { enumerable: true, get() { throw new Error('windowアクセサを読み取らない'); } });
  let tick;
  const document = { createElement: tag => new Element(tag), body: config.deferBody ? null : new Element('body') };
  const context = { window, document, location: { pathname: `/shop/${config.category || 'money'}` }, console: { error() {} },
    setInterval: fn => { tick = fn; return 0; }, clearInterval() {}, setTimeout: (fn, ms) => { timers.set(++timerId, fn); delays.set(timerId, ms); return timerId; }, clearTimeout: id => { timers.delete(id); delays.delete(id); } };
  vm.runInNewContext(source, context);
  nodes.find(n => n.textContent === '商品一覧・複数交換').onclick();
  return { api: window.__shinyMoneyMultiBuy, items, calls, callbacks, alerts, timers, scene, nodes, dialogs, chunks, document, tick,
    get engineLoads() { return engineLoads; },
    fire(ms) { const id = [...delays.keys()].find(id => delays.get(id) === ms); assert.ok(id, `待機タイマー ${ms}ms`); const fn = timers.get(id); timers.delete(id); delays.delete(id); fn(); },
    get confirmCalls() { return confirmCalls; },
    checkbox: nodes.find(n => n.type === 'checkbox'),
    inputs: nodes.filter(n => n.tag === 'input' && n.type === 'number'), start: nodes.find(n => n.textContent === '合計を確認して交換') };
}
(async () => {
  assert.match(source, /@run-at\s+document-start/);
  for (const chunkName of ['nzhn7nlklhxphz', 'futureGameChunks']) {
    const renamed = setup(true, { chunkName });
    assert.equal(renamed.nodes.find(n => n.textContent === '商品一覧・複数交換').style.display, 'block', 'ゲーム配列名が変わってもボタンを表示する');
    assert.equal(renamed.inputs.length, 2);
    renamed.tick();
    assert.equal(renamed.engineLoads, 1, 'エンジン取得を繰り返さない');
  }
  const early = setup(true, { deferBody: true, deferChunks: true });
  assert.equal(early.engineLoads, 0);
  assert.equal(early.inputs.length, 0);
  early.document.body = { children: [], append(n) { this.children.push(n); n.isConnected = true; } };
  early.tick();
  assert.equal(early.document.body.children.length, 1);
  assert.equal(early.nodes.find(n => n.textContent === '商品一覧・複数交換').style.display, 'none');
  early.chunks[0] = [[], { 4748: () => {} }];
  early.tick();
  assert.equal(early.engineLoads, 1, '後からロードされたショップチャンクを取得する');
  assert.equal(early.nodes.find(n => n.textContent === '商品一覧・複数交換').style.display, 'block');
  early.tick();
  assert.equal(early.document.body.children.length, 1, 'ボタンを重複追加しない');
  const s = setup();
  assert.equal(s.api.limit(s.items[0], 300), 3);
  assert.equal(s.api.limit({ ...s.items[0], currency: 'jewel' }, 1000), 0);
  const rows = count => [{ m: s.items[0], input: { value: String(count) } }];
  for (const count of [-1, 1.5, 6, Infinity]) assert.throws(() => s.api.plan(rows(count), 1000));
  assert.throws(() => s.api.plan(rows(0), 1000));
  assert.throws(() => s.api.plan([{ ...rows(4)[0] }, { m: s.items[1], input: { value: '4' } }], 500));
  assert.equal(s.api.plan(rows(3), 1000).total, 300);
  const quick = setup();
  const buttons = text => quick.nodes.filter(n => n.tag === 'button' && n.textContent === text);
  quick.inputs[1].value = '3';
  quick.scene._shopStore.userWallet.money = 500;
  buttons('最大')[0].onclick();
  assert.equal(quick.inputs[0].value, '2', '他商品の選択額を差し引いて最大を設定する');
  buttons('0')[0].onclick();
  assert.equal(quick.inputs[0].value, '0');
  buttons('すべて最大')[0].onclick();
  assert.deepEqual(quick.inputs.map(i => i.value), ['5', '0'], '一覧順に予算内で最大を設定する');
  assert.equal(quick.calls.length, 0, '数量ボタンは交換を実行しない');
  buttons('すべて0')[0].onclick();
  assert.deepEqual(quick.inputs.map(i => i.value), ['0', '0']);
  quick.items[0].isNotPurchasable = true;
  buttons('すべて最大')[0].onclick();
  assert.deepEqual(quick.inputs.map(i => i.value), ['0', '5'], '交換不可の商品を除外する');
  const cancel = setup(false); cancel.inputs[0].value = '2'; await cancel.start.onclick();
  assert.equal(cancel.calls.length, 0, '確認キャンセル時は送信しない');
  s.inputs[0].value = '2'; s.inputs[1].value = '3';
  const run = s.start.onclick();
  assert.equal(s.checkbox.checked, false, '初期状態では自動クローズしない');
  s.dialogs[0].emit('openEnd');
  assert.equal(s.dialogs[0].closeCalls, 0, 'オフなら公式結果画面を手動で閉じるまで待つ');
  assert.deepEqual(s.calls, [['1', 2]], '結果画面を閉じるまで次の交換を送信しない');
  s.callbacks.shift()(); await Promise.resolve();
  assert.deepEqual(s.calls, [['1', 2], ['2', 3]]);
  s.callbacks.shift()(); await run;
  assert.equal(s.api.busy, false);
  assert.equal(s.scene._shopStore.userWallet.money, 500);
  const auto = setup(); auto.checkbox.checked = true; auto.checkbox.events.change();
  assert.equal(auto.api.autoCloseResults, true, 'チェックボックスで設定を変更する');
  auto.inputs[0].value = '1'; auto.inputs[1].value = '1';
  const autoRun = auto.start.onclick();
  assert.equal(auto.dialogs[0].closeCalls, 0, '表示完了前には閉じない');
  auto.dialogs[0].emit('openEnd'); auto.fire(500);
  assert.equal(auto.dialogs[0].closeCalls, 1, '表示完了後に公式closeを一度呼ぶ');
  assert.equal(auto.calls.length, 1, '閉じるアニメーション完了まで次へ進まない');
  auto.dialogs[0].finishClose(); await Promise.resolve();
  assert.equal(auto.calls.length, 2);
  auto.dialogs[1].emit('openEnd'); auto.fire(500); auto.dialogs[1].finishClose(); await autoRun;
  assert.equal(auto.api.busy, false);
  const manual = setup(); manual.checkbox.checked = true; manual.inputs[0].value = '1';
  const manualRun = manual.start.onclick(); manual.dialogs[0].emit('openEnd');
  manual.dialogs[0].close(); manual.dialogs[0].finishClose(); await manualRun;
  assert.equal(manual.timers.size, 0, '手動で閉じた場合は自動クローズを取り消す');
  assert.equal(manual.dialogs[0].closeCalls, 1);
  const earlyClose = setup(); earlyClose.checkbox.checked = true; earlyClose.inputs[0].value = '1';
  const earlyRun = earlyClose.start.onclick();
  earlyClose.dialogs[0].close(); earlyClose.dialogs[0].emit('openEnd');
  assert.ok(![...earlyClose.timers.keys()].some(id => id !== 1), '表示アニメーション中の手動クローズ後は自動クローズを予約しない');
  earlyClose.dialogs[0].finishClose(); await earlyRun;
  assert.equal(earlyClose.dialogs[0].closeCalls, 1);
  const preference = setup(); preference.checkbox.checked = true; preference.checkbox.events.change();
  preference.nodes.find(n => n.textContent === '閉じる').onclick();
  preference.nodes.find(n => n.textContent === '商品一覧・複数交換').onclick();
  assert.equal(preference.nodes.filter(n => n.type === 'checkbox').at(-1).checked, true, '同じページで開き直すと設定を保持する');
  const autoTimeout = setup(); autoTimeout.checkbox.checked = true; autoTimeout.inputs[0].value = '1';
  const autoPending = autoTimeout.start.onclick(); autoTimeout.dialogs[0].emit('openEnd');
  autoTimeout.fire(180000); await autoPending;
  assert.equal(autoTimeout.timers.size, 0, '停止後は自動クローズのタイマーも消す');
  assert.equal(autoTimeout.dialogs[0].closeCalls, 0);
  const missing = setup(); missing.checkbox.checked = true; missing.inputs[0].value = '1';
  missing.scene._dialogLayer.showResult = () => { missing.scene._dialogLayer.children.push({ close() { throw new Error('別ダイアログを閉じてはいけない'); } }); };
  await missing.start.onclick();
  assert.equal(missing.api.busy, true, '結果を特定できなければ停止してロックする');
  assert.match(missing.alerts[0], /結果画面を特定できない/);
  const timeout = setup(); timeout.inputs[0].value = '1'; timeout.inputs[1].value = '1';
  const pending = timeout.start.onclick(); [...timeout.timers.values()][0](); await pending;
  assert.equal(timeout.calls.length, 1, '結果不明なら次へ進まず再送しない');
  assert.equal(timeout.api.busy, true, '結果不明時は再実行をロックする');
  const sample = (currency, walletKey, id = '10') => ({ id, title: `通貨:${currency}`, currency, walletKey, currencyName: currency, price: 10, getRestOfPurchaseCount: () => 10, calcPurchasableCountWithinPossessionNumLimit: () => 10 });
  const seal = setup(true, { category: 'staff_item_point', items: [sample('staff_item_point', 'staffItemPoint')], wallet: { staffItemPoint: 25 } });
  assert.equal(seal.inputs[0].max, '2', 'シール残高で上限を計算する');
  seal.inputs[0].value = '2'; const sealRun = seal.start.onclick(); seal.callbacks.shift()(); await sealRun;
  assert.equal(seal.scene._shopStore.userWallet.staffItemPoint, 5);
  const jointKey = 'joint_fes_event_point/123';
  const joint = setup(true, { category: 'game_event', items: [sample('joint_fes_event_point', jointKey)], wallet: { [jointKey]: 35 } });
  assert.equal(joint.inputs[0].max, '3', 'マッチライブPのイベント別残高で上限を計算する');
  assert.equal(joint.start.disabled, false, 'マッチライブPの商品は交換可能');
  joint.nodes.find(n => n.textContent === 'すべて最大').onclick();
  assert.equal(joint.inputs[0].value, '3');
  const jointRun = joint.start.onclick(); joint.callbacks.shift()(); await jointRun;
  assert.deepEqual(joint.calls, [['10', 3]], 'マッチライブPの商品を公式処理へ送る');
  assert.equal(joint.scene._shopStore.userWallet[jointKey], 5);
  for (const currency of ['exchange_item', 'idol_piece', 'fes_match_coin', 'scenario_event_point', 'fes_event_point', 'box_event_point', 'ranking_event_point']) {
    const other = setup(true, { category: 'game_event', items: [sample(currency, 'token')], wallet: { token: 35 } });
    assert.equal(other.inputs[0].max, '3', `${currency}の残高を参照する`);
  }
  for (const currency of ['jewel', 'billed_jewel', 'free_jewel', 'cash', 'bn_coin', 'unknown']) {
    const blocked = setup(true, { category: 'game_event', items: [sample(currency, 'token')], wallet: { token: 1000 } });
    assert.equal(blocked.inputs.length, 0, '表示専用商品は数量入力を生成しない');
    assert.equal(blocked.start.disabled, true);
    await blocked.start.onclick();
    assert.equal(blocked.confirmCalls, 0);
    assert.equal(blocked.calls.length, 0);
    assert.throws(() => blocked.api.plan([{ m: blocked.items[0], input: { value: '1' } }], { token: 1000 }, 'game_event'));
  }
  for (const category of ['jewel', 'premium', 'expansion', 'scout', 'monthly_passport', 'battle_passport', 'shiny_passport']) {
    const paid = setup(true, { category, items: [sample('money', 'money')], wallet: { money: 1000 } });
    assert.equal(paid.inputs.length, 0, `${category}は通貨にかかわらず表示専用`);
    await paid.start.onclick();
    assert.equal(paid.calls.length, 0);
    assert.equal(paid.confirmCalls, 0);
  }
  for (const change of [m => { m.currency = 'jewel'; }, m => { m.walletKey = 'billedJewel'; }, m => { m.purchaseProduct = { id: 'paid' }; }]) {
    const changed = setup(); changed.inputs[0].value = '1'; change(changed.items[0]);
    await changed.start.onclick();
    assert.equal(changed.calls.length, 0, '選択後に支払い方式が変わった場合も送信しない');
  }
  const paidContents = Object.create({ get merchandises() { throw new Error('決済画面の未構築一覧を参照しない'); } });
  paidContents.children = [{ text: '283パス', children: [{ text: '480円' }] }];
  const paidText = setup(true, { category: 'monthly_passport', items: [], contents: paidContents });
  assert.ok(paidText.nodes.some(n => n.textContent === '283パス / 480円'), 'モデル未取得の決済商品も描画済みテキストで表示する');
  assert.equal(paidText.inputs.length, 0);
  assert.equal(paidText.start.disabled, true);
  const categoryChanged = setup(true, { onConfirm: scene => { scene._currentCategory = 'premium'; } });
  categoryChanged.inputs[0].value = '1'; await categoryChanged.start.onclick();
  assert.equal(categoryChanged.calls.length, 0, '確認後に有料ページへ変わっても送信しない');
  const tradeItem = sample('money', 'money');
  tradeItem.tradeShopRequirements = [{ contentType: 'money', num: 10, name: 'マニー', getWalletKey: () => 'money' }, { contentType: 'exchange_item', num: 2, name: '素材', getWalletKey: () => 'exchange_item/1' }];
  const trade = setup(true, { category: 'trade', items: [tradeItem], wallet: { money: 100, 'exchange_item/1': 5 } });
  assert.equal(trade.inputs[0].max, '2', '複数素材のうち少ない残数で上限を計算する');
  const nativeResult = trade.scene._dialogLayer.showTradeResult;
  trade.inputs[0].value = '2'; const tradeRun = trade.start.onclick(); trade.callbacks.shift()(); await tradeRun;
  assert.deepEqual(trade.scene._shopStore.userWallet, { money: 80, 'exchange_item/1': 1 });
  assert.equal(trade.scene._dialogLayer.showTradeResult, nativeResult, '結果監視は元に戻す');
  assert.equal(trade.scene.updateCalls, 1, '公式の結果コールバックを一度だけ呼ぶ');
  const illegalTrade = { ...tradeItem, tradeShopRequirements: [{ contentType: 'jewel', num: 1, getWalletKey: () => 'freeJewel' }] };
  assert.ok(trade.api.readOnlyReason(illegalTrade, 'trade'));
  const evolutionTrade = { ...tradeItem, tradeShopRequirements: [{ contentType: 'evolution_item', num: 1, getWalletKey: () => 'evolution_item/401' }] };
  assert.equal(trade.api.limit(evolutionTrade, { 'evolution_item/401': 3 }), 3, '特訓素材のリサイクルにも対応する');
  const changedDuringExchange = setup();
  changedDuringExchange.inputs.forEach(input => { input.value = '1'; });
  const guardedRun = changedDuringExchange.start.onclick();
  changedDuringExchange.items[1].currency = 'billed_jewel';
  changedDuringExchange.callbacks.shift()(); await guardedRun;
  assert.equal(changedDuringExchange.calls.length, 1, '逐次交換の途中でジュエル商品に変わっても次を送信しない');
  const piece = setup(true, { category: 'piece', ownerCategory: 'idol_evolution_piece', items: [sample('exchange_item', 'ticket')], wallet: { ticket: 20 } });
  piece.inputs[0].value = '1'; const pieceRun = piece.start.onclick(); piece.callbacks.shift()(); await pieceRun;
  assert.equal(piece.scene.pieceUpdated, true, '特訓ピース用の公式完了処理を使う');
  const rebuild = setup(); rebuild.scene._shopContents._userShop = { id: 'same-shop' };
  rebuild.nodes.find(n => n.textContent === '閉じる').onclick();
  rebuild.nodes.find(n => n.textContent === '商品一覧・複数交換').onclick();
  rebuild.nodes.filter(n => n.type === 'number').slice(-2).forEach(input => { input.value = '1'; });
  const rebuildRun = rebuild.nodes.filter(n => n.textContent === '合計を確認して交換').at(-1).onclick();
  rebuild.scene._shopContents._userShop = { id: 'same-shop' };
  rebuild.callbacks.shift()(); await Promise.resolve();
  assert.equal(rebuild.calls.length, 2, '公式更新で同じ子ショップが再構築されても続行する');
  rebuild.callbacks.shift()(); await rebuildRun;
  const mixed = setup(true, { category: 'game_event', items: [sample('money', 'money', '20'), sample('exchange_item', 'ticket', '21')], wallet: { money: 25, ticket: 35 } });
  mixed.nodes.find(n => n.textContent === 'すべて最大').onclick();
  assert.deepEqual(mixed.inputs.map(i => i.value), ['2', '3'], '別通貨の予算を混同しない');
  console.log('PASS: 他ショップ通貨・複数素材・ジュエル/決済の表示専用・送信直前の再判定・自動クローズ・最大/0・逐次交換・再送防止');
})().catch(error => { console.error(error); process.exitCode = 1; });
