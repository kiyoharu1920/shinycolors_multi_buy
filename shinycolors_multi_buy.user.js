// ==UserScript==
// @name         シャニマス ショップ 複数交換
// @namespace    myAI.shinycolors.money
// @version      1.3.2
// @description  商品ごとに数量を選び、合計確認後に公式処理で順番に交換します。
// @match        https://shinycolors.enza.fun/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/**
 * ショップに数量選択パネルを追加する。ジュエル・実決済の商品は表示専用。
 * 数量設定では通信せず、ユーザーの確認後に公式の交換処理を順番に呼び出す。
 * ゲームの内部オブジェクト・Webpackの識別子に依存するため、更新時は再確認が必要。
 * @returns {void}
 */
(() => {
  'use strict';
  /**
   * このスクリプトで参照する、公式の商品モデルのプロパティとメソッド。
   * @typedef {Object} ShopMerchandise
   * @property {string} id 商品ID。
   * @property {string} title 商品名。
   * @property {string} currency 使用通貨。確認済みのゲーム内通貨だけを交換対象とする。
   * @property {string} walletKey 公式の残高キー。
   * @property {string} currencyName 通貨の表示名。
   * @property {object[]} [tradeShopRequirements] リサイクル交換で消費する素材と数量。
   * @property {number} price 1回の交換に必要な通貨数。
   * @property {boolean} isNotPurchasable 前提条件などにより交換できないか。
   * @property {function(): number} getRestOfPurchaseCount 残り交換回数。無制限ならInfinity。
   * @property {function(): number} calcPurchasableCountWithinPossessionNumLimit 所持上限までの交換回数。
   */
  /**
   * @typedef {Object} QuantityRow
   * @property {ShopMerchandise} m 商品モデル。
   * @property {HTMLInputElement|{value: string}} input 数量入力欄。表示専用行は0固定。
   */
  /**
   * 確認後に交換する商品。入力欄を再参照せず、この数量を使う。
   * @typedef {Object} ExchangeItem
   * @property {string} id 商品ID。
   * @property {string} name 確認画面に表示する商品名。
   * @property {number} count 交換回数。セット商品では内容物の個数ではない。
   * @property {number} price 確認時の単価。実行直前に公式モデルの単価と照合する。
   * @property {ExchangeCost[]} costs 消費する通貨・素材の一覧。
   * @property {string} currency 確認時の通貨種別。
   */
  /**
   * @typedef {{key: string, name: string, amount: number}} ExchangeCost
   * @typedef {Object<string, number>} Balances 通貨・素材ごとの残高。
   */
  // 再注入でボタンや定期監視を重複させない。
  if (window.__shinyMoneyMultiBuy) return;
  // 結果不明で停止した場合もbusyを維持し、二重送信を防ぐ。
  const api = window.__shinyMoneyMultiBuy = { busy: false, autoCloseResults: false };
  let engine;
  const allowedCurrencies = new Set(['money', 'staff_item_point', 'exchange_item', 'idol_piece', 'fes_match_coin', 'scenario_event_point', 'fes_event_point', 'joint_fes_event_point', 'box_event_point', 'ranking_event_point']);
  const blockedCategories = new Set(['jewel', 'premium', 'expansion', 'scout', 'monthly_passport', 'battle_passport', 'shiny_passport']);
  const allowedMaterials = new Set(['money', 'exchange_item', 'produce_item', 'enhancement_item', 'recovery_item', 'idol_piece', 'evolution_item']);
  const shopData = new WeakMap();
  let panelContext;
  /**
   * 通貨・素材の数量を日本語の桁区切り表記にする。
   * @param {number} n 表示する数量。
   * @returns {string} 桁区切り済みの文字列。
   */
  const fmt = n => n.toLocaleString('ja-JP');
  /**
   * DOM要素を作成し、必要なら表示テキストと親要素を設定する。
   * 商品名はHTMLとして解釈せず、textContentで表示する。
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag HTMLタグ名。
   * @param {string} [text] 表示テキスト。
   * @param {HTMLElement} [parent] 作成した要素の追加先。
   * @returns {HTMLElementTagNameMap[K]} 作成した要素。
   */
  const element = (tag, text, parent) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };
  /**
   * ショップのURLと公式の商品データが揃ったときだけ対象シーンを返す。
   * @returns {object|null} ショップのシーン。他画面や読み込み中はnull。
   */
  function current() {
    const s = engine?.sceneManager?.currentScene;
    return /^\/shop(?:\/|$)/.test(location.pathname) && s?._currentCategory && s._shopStore && s._shopContents ? s : null;
  }
  /**
   * 実支払い・ジュエル・未確認の通貨は交換経路へ通さない。
   * UIの無効化だけでなく、予定作成と送信直前にもこの判定を使う。
   * @param {ShopMerchandise} m 商品モデル。
   * @param {string} [category] 現在のショップカテゴリ。
   * @returns {string} 表示専用の理由。交換可能な方式なら空文字列。
   */
  function readOnlyReason(m, category) {
    if (blockedCategories.has(category) || m.purchaseProduct || m.purchaseProductId || m.productId || m.isPremium || /jewel|billed|freeJewel/i.test(m.currency || '')) return 'ジュエル・実決済は表示のみ';
    if (m._displayOnly) return '商品データ未取得・表示のみ';
    const requirements = m.tradeShopRequirements || [];
    if (requirements.length) {
      if (requirements.some(r => !allowedMaterials.has(r.contentType) || typeof r.getWalletKey !== 'function' || !Number.isSafeInteger(r.num) || r.num <= 0)) return '未対応の交換素材・表示のみ';
    } else if (!allowedCurrencies.has(m.currency)) return '未確認の通貨・表示のみ';
    try {
      if (costs(m).some(c => /jewel|billed|cash|payment|bandai|yen/i.test(c.key) || !Number.isSafeInteger(c.amount) || c.amount < 0)) return '未対応の支払い・表示のみ';
    } catch (error) { return '通貨情報未取得・表示のみ'; }
    return '';
  }
  /**
   * 1回の交換で消費する通貨・素材を公式モデルから取得する。
   * @param {ShopMerchandise} m 商品モデル。
   * @returns {ExchangeCost[]} 同じ残高キーの素材は数量を合算する。
   */
  function costs(m) {
    const values = m.tradeShopRequirements?.length ? m.tradeShopRequirements.map(r => ({ key: r.getWalletKey(), name: r.name || r.content?.name || r.contentType, amount: r.num })) : [{ key: m.walletKey || (m.currency === 'money' ? 'money' : ''), name: m.currencyName || m.currency, amount: m.price }];
    const merged = new Map();
    for (const c of values) {
      if (!c.key) throw new Error('残高キーを取得できません。');
      const old = merged.get(c.key);
      merged.set(c.key, { ...c, amount: c.amount + (old?.amount || 0) });
    }
    return [...merged.values()];
  }
  /**
   * 現在の通貨・素材残高を読む。
   * @param {object} scene ショップのシーン。
   * @param {ShopMerchandise[]} items 対象商品。
   * @returns {Balances} 交換に使用できる残高。
   */
  function balances(scene, items) {
    const result = {};
    for (const m of items) {
      if (readOnlyReason(m, scene._currentCategory)) continue;
      for (const c of costs(m)) result[c.key] = scene._shopStore.userWallet[c.key];
    }
    return result;
  }
  /**
   * カテゴリ・子ショップ・絞り込みが変わったら、古いパネルからの実行を止める。
   * @param {object} scene ショップのシーン。
   * @returns {Array<*>} 画面状態の識別に使う値。
   */
  function context(scene) {
    const contents = scene?._shopContents;
    // 特訓ピースの結果確認後は同じ子ショップのモデルが作り直されるため、IDで比較する。
    return [scene, scene?._currentCategory, contents, contents?._userShop?.id ?? contents?._userShop, contents?._smallTabKey];
  }
  /**
   * 保存した画面状態と現在の画面状態を比較する。
   * @param {Array<*>|undefined} a 保存した状態。
   * @param {Array<*>} b 現在の状態。
   * @returns {boolean|undefined} 状態が一致するか。
   */
  const sameContext = (a, b) => a?.every((value, i) => value === b[i]);
  /**
   * 公式の表示一覧と商品モデルを対応づける。パスポートなどのデータも保持する。
   * @param {object} scene ショップのシーン。
   * @returns {ShopMerchandise[]} 現在の一覧の商品。表示専用の代替行を含む。
   */
  function listItems(scene) {
    const contents = scene._shopContents;
    const shops = scene._shopStore.userShops || [];
    const data = shopData.get(scene._shopStore)?.data;
    const all = shops.flatMap(s => [...(s.shopMerchandises || []), ...(s.extraShopMerchandises || [])]);
    const visible = contents._merchandiseList || Object.hasOwn(contents, 'merchandises') ? contents.merchandises : undefined;
    let items;
    if (Array.isArray(visible) && visible.length) {
      items = visible.map(v => v._shopMerchandise || all.find(m => m.id === v.shopMerchandiseId)).filter(Boolean);
    } else if (contents._userShop) items = contents._userShop.shopMerchandises || [];
    else items = shops.filter(s => s.category === scene._currentCategory).flatMap(s => s.shopMerchandises || []);
    if (!items.length && data?.category === scene._currentCategory) items = data.shopMerchandise ? [data.shopMerchandise] : (data.purchaseProducts || []).map(p => p.shopMerchandise).filter(Boolean);
    if (!items.length) {
      // 決済データを読み直す通信はせず、既に描画された商品情報を表示用に拾う。
      const texts = []; const visited = new Set();
      const visit = node => {
        if (!node || visited.has(node)) return;
        visited.add(node);
        if (typeof node.text === 'string' && node.text.trim()) texts.push(node.text.trim());
        for (const child of node.children || []) visit(child);
      };
      visit(contents._merchandiseUi || contents);
      if (texts.length) items = [{ id: 'display-only', title: [...new Set(texts)].join(' / '), _displayOnly: true }];
    }
    return [...new Map(items.map(m => [m.id, m])).values()];
  }
  /**
   * 交換残数・所持上限・指定予算のすべてを満たす最大交換回数を求める。
   * @param {ShopMerchandise} m 対象の商品モデル。
   * @param {Balances|number} wallet 使用できる通貨・素材。数値の場合はマニー残高。
   * @returns {number} 最大交換回数。対象外・交換不可・不正な単価の場合は0。
   */
  function limit(m, wallet) {
    if (readOnlyReason(m) || m.isNotPurchasable || typeof m.getRestOfPurchaseCount !== 'function' || typeof m.calcPurchasableCountWithinPossessionNumLimit !== 'function') return 0;
    const available = typeof wallet === 'number' ? { money: wallet } : wallet;
    const budgets = costs(m).map(c => Number.isSafeInteger(available[c.key]) && available[c.key] >= 0 ? (c.amount === 0 ? Infinity : Math.floor(available[c.key] / c.amount)) : 0);
    const cap = Math.min(m.getRestOfPurchaseCount(), m.calcPurchasableCountWithinPossessionNumLimit(), ...budgets);
    return Number.isSafeInteger(cap) && cap >= 0 ? cap : 0;
  }
  /**
   * 入力数量と通貨・素材ごとの合計を検証し、0個の商品を除いた交換予定を作る。通信はしない。
   * @param {QuantityRow[]} rows 商品と数量入力欄の一覧。
   * @param {Balances|number} wallet 検証に使う通貨・素材の残高。
   * @param {string} [category] 表示専用ページの送信を防ぐためのカテゴリ。
   * @returns {{selected: ExchangeItem[], total: number, totals: Balances}} 一覧順の交換予定と通貨別合計。
   * @throws {Error} 数量不正、上限超過、予算超過、または選択商品がない場合。
   */
  function plan(rows, wallet, category) {
    const available = typeof wallet === 'number' ? { money: wallet } : wallet;
    const totals = {};
    const selected = [];
    for (const { m, input } of rows) {
      const count = Number(input.value);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${m.title}: 数量を確認してください。`);
      if (!count) continue;
      const reason = readOnlyReason(m, category);
      if (reason) throw new Error(`${m.title}: ${reason}`);
      if (count > limit(m, available)) throw new Error(`${m.title}: 数量を確認してください。`);
      for (const c of costs(m)) {
        totals[c.key] = (totals[c.key] || 0) + c.amount * count;
        if (!Number.isSafeInteger(totals[c.key]) || totals[c.key] > available[c.key]) throw new Error(`${c.name}の合計が所持数を超えています。`);
      }
      selected.push({ id: m.id, name: m.title || m.shopTitle, count, price: m.price, currency: m.currency, costs: costs(m) });
    }
    if (!selected.length) throw new Error('交換する数量を入力してください。');
    return { selected, total: totals.money || 0, totals };
  }
  api.limit = limit;
  api.plan = plan;
  api.readOnlyReason = readOnlyReason;
  const button = element('button', '商品一覧・複数交換');
  button.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483646;padding:10px 16px;background:#b21b75;color:white;border:2px solid white;border-radius:8px;font-size:16px;cursor:pointer;display:none';
  let panel;
  /**
   * 現在のカテゴリの商品を数量選択パネルへ表示し、各ボタンの処理を登録する。
   * 公式ダイアログ表示中・交換中・パネル表示済みの場合は開かない。
   * @returns {void}
   */
  function open() {
    const scene = current();
    if (!scene || api.busy || panel) return;
    if (scene._dialogLayer.children.length || !scene.interactiveChildren) return;
    panel = element('div');
    panel.style.cssText = 'position:fixed;inset:3%;z-index:2147483647;background:#fff;color:#222;border:3px solid #b21b75;border-radius:12px;padding:16px;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;text-align:left;white-space:normal;font:15px sans-serif;box-shadow:0 0 0 100vmax #0008;touch-action:pan-y';
    // ゲームのdocument側スクロール抑止へイベントを伝えない。
    for (const type of ['wheel', 'touchmove']) panel.addEventListener(type, e => e.stopPropagation());
    document.body.append(panel);
    element('h2', 'ショップ 商品一覧・複数交換', panel);
    element('p', '現在のカテゴリの商品を数量指定できます。結果画面を閉じると次の商品へ進みます。自動で閉じる設定も選べます。', panel);
    // 表示と合計更新には開いた時点の残高を使い、交換前には現在値で再検証する。
    panelContext = context(scene);
    const category = scene._currentCategory;
    const items = listItems(scene);
    const wallet = balances(scene, items);
    const names = new Map(items.filter(m => !readOnlyReason(m, category)).flatMap(m => costs(m)).map(c => [c.key, c.name]));
    const describe = values => Object.entries(values).map(([key, value]) => `${names.get(key) || key}: ${Number.isSafeInteger(value) ? fmt(value) : '未取得'}`).join(' / ');
    element('p', `所持数: ${describe(wallet) || 'このページは表示専用です。'}`, panel);
    element('p', 'ジュエル・実際の支払いを伴う商品は、このスクリプトでは一覧表示のみです。', panel);
    const controls = element('div', undefined, panel);
    const autoCloseLabel = element('label', undefined, controls);
    autoCloseLabel.style.cssText = 'display:block;margin:8px 0';
    const autoClose = element('input', undefined, autoCloseLabel);
    autoClose.type = 'checkbox';
    autoClose.checked = api.autoCloseResults;
    autoClose.setAttribute('aria-label', '結果画面を自動で閉じる');
    element('span', ' 結果画面を自動で閉じる', autoCloseLabel);
    // 同じページでパネルを開き直した場合は設定を保持する。再読み込み後はオフ。
    autoClose.addEventListener('change', () => { api.autoCloseResults = autoClose.checked; });
    const allMax = element('button', 'すべて最大', controls);
    const allZero = element('button', 'すべて0', controls);
    element('p', '「すべて最大」は一覧の上から各通貨・素材の所持数の範囲で設定します。', controls);
    for (const b of [allMax, allZero]) b.style.cssText = 'font:inherit;padding:8px;margin:4px';
    const table = element('table', undefined, panel);
    table.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse';
    const header = element('tr', undefined, table);
    for (const label of ['商品', '必要通貨・素材', '交換可能数', '数量']) element('th', label, header);
    const rows = items.map(m => {
      const tr = element('tr', undefined, table);
      element('td', m.title || m.shopTitle || '名称未取得', tr);
      const reason = readOnlyReason(m, category);
      const costText = reason ? `${m.price ?? '価格未取得'} ${m.purchaseProduct?.currencyName || m.currency || ''}（${reason}）` : costs(m).map(c => `${c.name} × ${fmt(c.amount)}`).join(' / ');
      element('td', costText, tr);
      const cap = reason ? 0 : limit(m, wallet);
      element('td', reason ? '表示のみ' : String(cap), tr);
      const quantity = element('td', undefined, tr);
      if (reason) { element('span', '購入不可', quantity); return { m, input: { value: '0' } }; }
      const input = element('input', undefined, quantity);
      input.type = 'number'; input.min = '0'; input.max = String(cap); input.step = '1'; input.value = '0';
      input.setAttribute('aria-label', `${m.title} (${m.id}) の数量`);
      input.style.cssText = 'width:100%;max-width:80px;box-sizing:border-box;font:inherit;padding:6px';
      input.disabled = cap === 0;
      const max = element('button', '最大', quantity);
      const zero = element('button', '0', quantity);
      max.setAttribute('aria-label', `${m.title} (${m.id}) を最大数にする`);
      zero.setAttribute('aria-label', `${m.title} (${m.id}) を0個にする`);
      max.disabled = input.disabled;
      for (const b of [max, zero]) b.style.cssText = 'font:inherit;padding:4px;margin:3px 2px';
      /**
       * 他商品の数量を維持し、その選択額を控除した予算で対象商品の最大数を設定する。
       * 他の入力が不正な場合は変更せず、メッセージを表示する。
       * @returns {void}
       */
      max.onclick = () => {
        try {
          const remaining = balances(scene, items);
          for (const row of rows) {
            if (row.input === input) continue;
            const count = Number(row.input.value);
            if (!Number.isSafeInteger(count) || count < 0 || (count && (readOnlyReason(row.m, category) || count > limit(row.m, balances(scene, items))))) throw new Error('ほかの商品の数量を確認してください。');
            if (count) for (const c of costs(row.m)) remaining[c.key] = Math.max(0, remaining[c.key] - c.amount * count);
          }
          input.value = String(limit(m, remaining));
          update();
        } catch (error) { status.textContent = error.message; }
      };
      // 数量ボタンは入力と合計表示だけを更新し、交換処理は呼び出さない。
      zero.onclick = () => { input.value = '0'; update(); };
      return { m, input };
    });
    for (const cell of table.querySelectorAll('td,th')) cell.style.cssText = 'padding:8px;border-bottom:1px solid #ddd;text-align:left;white-space:normal;overflow-wrap:anywhere';
    const status = element('p', '数量を入力してください。', panel);
    status.setAttribute('role', 'status');
    const start = element('button', '合計を確認して交換', panel);
    const hasExchangeItems = items.some(m => !readOnlyReason(m, category));
    start.disabled = !hasExchangeItems;
    allMax.disabled = !hasExchangeItems;
    allZero.disabled = !hasExchangeItems;
    autoClose.disabled = !hasExchangeItems;
    if (!items.length) status.textContent = '表示できる商品がありません。公式画面で商品一覧を開いてください。';
    else if (!hasExchangeItems) status.textContent = 'この一覧は表示専用です。購入・交換はできません。';
    const close = element('button', '閉じる', panel);
    for (const b of [start, close]) b.style.cssText = 'font:inherit;padding:10px;margin:8px';
    /**
     * パネルを閉じ、次回の表示を可能にする。
     * @returns {void}
     */
    const dismiss = () => { panel?.remove(); panel = null; panelContext = null; };
    close.onclick = dismiss;
    /**
     * 入力を検証し、合計・残高または入力エラーを表示する。
     * @returns {void}
     */
    const update = () => {
      try { const p = plan(rows, wallet, category); status.textContent = `合計: ${describe(p.totals)} / ${p.selected.length}種類`; }
      catch (error) { status.textContent = error.message; }
    };
    rows.forEach(r => r.input.addEventListener?.('input', update));
    /**
     * 既存の数量を置き換え、一覧の先頭から順番に残り予算を割り当てる。
     * 全商品それぞれの最大数を同時に選んで予算を超えることを避ける。
     * @returns {void}
     */
    allMax.onclick = () => {
      const remaining = balances(scene, items);
      for (const { m, input } of rows) {
        const count = readOnlyReason(m, category) ? 0 : limit(m, remaining);
        input.value = String(count);
        if (count) for (const c of costs(m)) remaining[c.key] -= c.amount * count;
      }
      update();
    };
    /**
     * 全商品の数量を0に戻す。交換済みの商品を取り消す操作ではない。
     * @returns {void}
     */
    allZero.onclick = () => { rows.forEach(r => { r.input.value = '0'; }); update(); };
    /**
     * 商品状態を再検証し、合計の確認後に公式処理で逐次交換する。
     * 各結果画面の閉じる処理が完了するまで次の商品へ進まない。
     * 自動クローズが有効なら表示完了後に公式closeを呼ぶ。失敗時は再送せず実行をロックする。
     * @returns {Promise<void>} 全商品の結果確認、または停止メッセージ表示後に完了する。
     */
    start.onclick = async () => {
      let selection;
      const executionContext = context(scene);
      try {
        if (current() !== scene || !sameContext(panelContext, executionContext) || scene._dialogLayer.children.length || !scene.interactiveChildren) throw new Error('ショップの状態が変わりました。一度閉じて開き直してください。');
        selection = plan(rows, balances(scene, items), category);
        // 一覧作成後に商品状態が変わっていたら、新しい一覧からやり直す。
        for (const p of selection.selected) {
          const m = scene._shopStore.findShopMerchandise(p.id);
          if (!m || readOnlyReason(m, category) || m.price !== p.price || m.currency !== p.currency || JSON.stringify(costs(m)) !== JSON.stringify(p.costs) || p.count > limit(m, balances(scene, [m]))) throw new Error('商品情報が変わりました。開き直してください。');
        }
      } catch (error) { status.textContent = error.message; return; }
      // 実行中に設定が変わらないよう、この交換予定に使う値を確定する。
      const shouldAutoClose = autoClose.checked;
      const text = selection.selected.map(p => `${p.name} × ${p.count}: ${p.costs.map(c => `${c.name} ${fmt(c.amount * p.count)}`).join(' / ')}`).join('\n');
      if (!window.confirm(`${text}\n\n合計 ${describe(selection.totals)} を使用して交換しますか？\n結果画面: ${shouldAutoClose ? '自動で閉じる' : '手動で閉じる'}\n途中停止しても交換済みの商品は戻りません。`)) return;
      // 確認を承諾した後にだけ、数量パネルを閉じて交換を開始する。
      dismiss();
      api.busy = true;
      button.disabled = true;
      let completed = 0;
      try {
        for (const p of selection.selected) {
          if (current() !== scene || !sameContext(executionContext, context(scene))) throw new Error('ショップ・カテゴリが変わったため停止しました。');
          const m = scene._shopStore.findShopMerchandise(p.id);
          if (!m || readOnlyReason(m, scene._currentCategory) || m.price !== p.price || m.currency !== p.currency || JSON.stringify(costs(m)) !== JSON.stringify(p.costs) || p.count > limit(m, balances(scene, [m]))) throw new Error('商品・通貨・残数・所持数が変わったため停止しました。');
          button.textContent = `${completed + 1}/${selection.selected.length} ${shouldAutoClose ? '交換処理中' : '結果画面を閉じてください'}`;
          await new Promise((resolve, reject) => {
            let settled = false;
            let autoCloseTimer;
            const layer = scene._dialogLayer;
            const hooks = [];
            // 結果が出たとき、または停止したときに一時的な監視を元へ戻す。
            const restore = () => { for (const h of hooks) if (layer[h.key] === h.wrapper) layer[h.key] = h.original; };
            /**
             * 待機中の交換を一度だけ完了・停止し、遅れて届く自動クローズを無効にする。
             * @param {Error} [error] 停止理由。省略時は次の商品へ進む。
             * @returns {void}
             */
            const finish = error => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              clearTimeout(autoCloseTimer);
              restore();
              if (error) reject(error); else resolve();
            };
            // 通信結果が不明な場合は再送しない。再実行にはページの再読み込みが必要。
            const timer = setTimeout(() => finish(new Error('結果の確認を待機中です。交換結果を確認してからページを再読み込みしてください。自動再送はしません。')), 180000);
            try {
              // カテゴリごとの公式完了処理を維持し、該当商品の結果表示だけを監視する。
              for (const key of ['showResult', 'showTradeResult', 'showExtraMerchandiseExchangingResult']) {
                if (typeof layer[key] !== 'function') continue;
                const original = layer[key];
                const wrapper = function(options) {
                  if (settled || options.shopMerchandise?.id !== m.id) return original.call(this, options);
                  restore();
                  const previous = new Set(layer.children);
                  const result = original.call(this, { ...options, onClose: () => {
                    try { options.onClose?.(); finish(); } catch (error) { finish(error); }
                  } });
                  if (!shouldAutoClose || settled) return result;
                  // 今回の成功結果として追加されたダイアログだけを対象にする。
                  // エラーや確認ダイアログを探して一括で閉じることはしない。
                  const dialogs = layer.children.filter(child => !previous.has(child));
                  const dialog = dialogs.length === 1 ? dialogs[0] : null;
                  if (!dialog || typeof dialog.once !== 'function' || typeof dialog.close !== 'function') {
                    finish(new Error('結果画面を特定できないため停止しました。手動で結果を確認してください。'));
                    return result;
                  }
                  let closing = false;
                  dialog.once('openEnd', () => {
                    if (settled || closing) return;
                    // 開くアニメーションと競合しないよう、表示完了から500ms待つ。
                    autoCloseTimer = setTimeout(() => {
                      if (settled || closing || current() !== scene || dialog._destroyed || !layer.children.includes(dialog)) return;
                      try { dialog.close(); } catch (error) { finish(error); }
                    }, 500);
                  });
                  // 手動で先に閉じた場合は自動クローズを取り消す。
                  dialog.once('closeStart', () => { closing = true; clearTimeout(autoCloseTimer); });
                  return result;
                };
                hooks.push({ key, original, wrapper });
                layer[key] = wrapper;
              }
              if (!hooks.length) throw new Error('公式の結果表示処理を取得できません。');
              const owner = scene._shopStore.getUserShopFromShopMerchandise?.(m);
              const handler = m.tradeShopRequirements?.length ? scene._onTraded : owner?.category === 'idol_evolution_piece' ? scene._onIdolEvolutionPiecePurchased : scene._onPurchased;
              if (typeof handler !== 'function') throw new Error('この商品の公式交換処理を取得できません。');
              scene._onSubmitPurchase(m, p.count, function(updated, count, missions, ignored, changedVip) {
                try { handler.call(scene, updated, count, missions, null, changedVip); }
                catch (error) { finish(error); }
              });
            } catch (error) { finish(error); }
          });
          completed++;
        }
        window.alert(`${completed}種類の交換が完了しました。`);
        api.busy = false;
        button.disabled = false;
        button.textContent = '商品一覧・複数交換';
      } catch (error) {
        button.textContent = '停止中・再読み込みが必要';
        window.alert(`${completed}種類の結果確認後に停止しました。\n${error.message}`);
        console.error('[ショップ複数交換]', error);
      }
    };
  }
  button.onclick = open;
  /**
   * 読み込み済みWebpackチャンクから公式エンジンを取得し、画面遷移に合わせて表示を切り替える。
   * ショップのチャンクが読み込まれるまで取得を待ち、他画面へ移動したらパネルを閉じる。
   * @returns {void}
   */
  const tick = () => {
    // document-startではbodyがまだない。構築後にボタンを追加する。
    if (!document.body) return;
    if (!button.isConnected) document.body.append(button);
    if (!engine) {
      // 配列名はゲーム更新で変わるため、確認済みショップモジュールで識別する。
      // windowのアクセサを実行せず、値として公開された配列だけ調べる。
      for (const key of Object.keys(window)) {
        const chunks = Object.getOwnPropertyDescriptor(window, key)?.value;
        if (!Array.isArray(chunks) || chunks.push === Array.prototype.push || !chunks.some(c => c?.[1]?.[4748])) continue;
        chunks.push([[`myai-money-${Date.now()}`], {}, require => {
          if (require.m && !Object.hasOwn(require.m, 77528)) return;
          const candidate = require(77528);
          if (candidate?.sceneManager) engine = candidate;
        }]);
        if (engine) break;
      }
    }
    const scene = current();
    if (scene && !shopData.has(scene._shopStore)) {
      const store = scene._shopStore;
      const original = store.update;
      const record = { data: null, original, wrapper: null };
      if (typeof original === 'function') {
        record.wrapper = function(data) { record.data = data; return original.call(this, data); };
        store.update = record.wrapper;
      }
      shopData.set(store, record);
    }
    button.style.display = scene ? 'block' : 'none';
    if (panel && (!scene || !sameContext(panelContext, context(scene)))) { panel.remove(); panel = null; panelContext = null; }
  };
  // SPAではURL遷移だけでスクリプトが再実行されないため、表示状態を定期確認する。
  const timer = setInterval(() => {
    try { tick(); }
    catch (error) { clearInterval(timer); console.error('[ショップ複数交換] 初期化に失敗', error); }
  }, 1000);
  tick();
})();
