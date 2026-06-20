export const currency = Object.freeze({
  name: '듀코인',
  code: 'DUC',
  emoji: '🦴'
});

export const gradeOrder = Object.freeze(['쓰레기', '일반', '고급', '희귀', '영웅', '전설', '신화']);

export const gradeColors = Object.freeze({
  쓰레기: 0x747f8d,
  일반: 0x95a5a6,
  고급: 0x57f287,
  희귀: 0x3498db,
  영웅: 0x9b59b6,
  전설: 0xf1c40f,
  신화: 0xff4d8d
});

export const fishingItems = Object.freeze([
  { id: 'wet_sock', name: '젖은 양말', grade: '쓰레기', price: 1, weight: 700, description: '축축하다멍… 왜 바다에 있었는지는 비밀이다멍.' },
  { id: 'crushed_can', name: '찌그러진 캔', grade: '쓰레기', price: 2, weight: 700, description: '재활용 통으로 보내주자멍!' },
  { id: 'broken_rod', name: '부러진 낚싯대', grade: '쓰레기', price: 5, weight: 700, description: '장비로 쓸 수는 없지만 고물 값은 조금 나온다멍.' },
  { id: 'common_fish', name: '흔한 물고기', grade: '일반', price: 15, weight: 1500, description: '가나디 월드 어디서나 만나는 물고기다멍.' },
  { id: 'small_shell', name: '작은 조개', grade: '일반', price: 20, weight: 1500, description: '귀에 대면 파도 소리가 들리는 것 같다멍.' },
  { id: 'freshwater_shrimp', name: '민물 새우', grade: '일반', price: 25, weight: 1500, description: '통통 튀는 작은 새우다멍!' },
  { id: 'silver_fish', name: '은빛 물고기', grade: '고급', price: 80, weight: 667, description: '비늘이 은빛으로 반짝인다멍.' },
  { id: 'shiny_shell', name: '반짝 조개', grade: '고급', price: 100, weight: 667, description: '안쪽이 보석처럼 빛나는 조개다멍.' },
  { id: 'small_treasure', name: '작은 보물상자', grade: '고급', price: 150, weight: 667, description: '누가 흘렸는지 모를 작은 보물상자다멍.' },
  { id: 'gold_fish', name: '황금 물고기', grade: '희귀', price: 500, weight: 300, description: '온몸이 황금빛으로 빛나는 귀한 물고기다멍!' },
  { id: 'ancient_coin', name: '고대 동전', grade: '희귀', price: 700, weight: 300, description: '듀코인보다 훨씬 오래된 동전이다멍.' },
  { id: 'mystic_pearl', name: '신비한 진주', grade: '희귀', price: 1200, weight: 300, description: '달빛을 머금은 듯 은은하게 빛난다멍.' },
  { id: 'deepsea_gem', name: '심해의 보석', grade: '영웅', price: 2500, weight: 100, description: '아주 깊은 바다에서 올라온 보석이다멍.' },
  { id: 'spirit_scale', name: '바다 정령의 비늘', grade: '영웅', price: 3000, weight: 100, description: '손에 올리면 시원한 바람이 분다멍.' },
  { id: 'forgotten_ring', name: '잊혀진 왕의 반지', grade: '영웅', price: 4000, weight: 100, description: '어느 왕국의 보물이었을지도 모른다멍.' },
  { id: 'golden_bone', name: '가나디의 황금 뼈다귀', grade: '전설', price: 8000, weight: 30, description: '가나디가 눈을 반짝이는 전설의 뼈다귀다멍!' },
  { id: 'deepsea_crown', name: '심해의 왕관', grade: '전설', price: 10000, weight: 30, description: '심해의 왕이 쓰던 왕관이라는 소문이 있다멍.' },
  { id: 'starlight_hook', name: '별빛 낚싯바늘', grade: '전설', price: 12000, weight: 30, description: '별빛으로 물고기를 이끈다멍.' },
  { id: 'duc_origin_stone', name: '듀코인의 근원석', grade: '신화', price: 50000, weight: 5, description: '듀코인의 시작과 관련 있다는 신화의 광석이다멍.' },
  { id: 'ganadi_world_heart', name: '가나디 월드의 심장', grade: '신화', price: 100000, weight: 5, description: '가나디 월드의 생명력이 뛰는 듯한 보물이다멍.' }
]);

export const rods = Object.freeze([
  { id: 'old_rod', name: '낡은 낚싯대', price: 0, rareBonus: 0, highGradeBonus: 0, saleBonus: 0, cooldownMultiplier: 1, unlockMythic: false, description: '모두가 처음 받는 기본 낚싯대' },
  { id: 'sturdy_rod', name: '튼튼한 낚싯대', price: 2500, rareBonus: 0, highGradeBonus: 0.03, saleBonus: 0, cooldownMultiplier: 1, unlockMythic: false, description: '고급 아이템 확률 +3%' },
  { id: 'silver_rod', name: '은빛 낚싯대', price: 8000, rareBonus: 0.02, highGradeBonus: 0.05, saleBonus: 0, cooldownMultiplier: 0.95, unlockMythic: false, description: '고급 +5% · 희귀 이상 +2%' },
  { id: 'gold_rod', name: '황금 낚싯대', price: 25000, rareBonus: 0.05, highGradeBonus: 0.05, saleBonus: 0.05, cooldownMultiplier: 0.9, unlockMythic: false, description: '희귀 이상 +5% · 판매가 +5%' },
  { id: 'ganadi_rod', name: '가나디 낚싯대', price: 75000, rareBonus: 0.08, highGradeBonus: 0.08, saleBonus: 0.08, cooldownMultiplier: 0.75, unlockMythic: true, description: '희귀 이상 +8% · 쿨타임 감소 · 신화 해금' },
  { id: 'starlight_rod', name: '별빛 낚싯대', price: 250000, rareBonus: 0.15, highGradeBonus: 0.12, saleBonus: 0.12, cooldownMultiplier: 0.6, unlockMythic: true, description: '전설·신화 확률 증가 · 쿨타임 크게 감소' }
]);

export const shopItems = Object.freeze([
  ...rods.filter((rod) => rod.price > 0).map((rod) => ({ ...rod, type: 'rod', unique: true })),
  { id: 'ganadi_bait', name: '가나디 미끼', type: 'consumable', price: 300, unique: false, description: '다음 낚시에서 고급 이상 확률이 증가하며 자동 사용' },
  { id: 'lucky_collar', name: '행운의 목줄', type: 'upgrade', price: 2000, unique: true, description: '미니게임 승리 순이익 +5%' },
  { id: 'newspaper_subscription', name: '경제신문 구독권', type: 'upgrade', price: 1500, unique: true, description: '경제뉴스에서 추가 시장 힌트 확인' },
  { id: 'shiny_bucket', name: '반짝이는 양동이', type: 'upgrade', price: 1000, unique: true, description: '낚시 인벤토리 보관 한도 +50' },
  { id: 'wallet_skin', name: '듀코인 지갑 스킨', type: 'upgrade', price: 5000, unique: true, description: '지갑 화면을 반짝이게 꾸미는 장식' },
  { id: 'fluffy_title', name: '칭호: 말랑한 듀친구', type: 'title', title: '말랑한 듀친구', price: 3000, unique: true, description: '프로필에 장착할 수 있는 칭호' }
]);

export const virtualStocks = Object.freeze([
  { symbol: 'MFOOD', name: '멍푸드', initialPrice: 320, volatility: 0.025, risk: '낮음', description: '강아지 간식 회사' },
  { symbol: 'CATEL', name: '캣닢전자', initialPrice: 480, volatility: 0.07, risk: '높음', description: '고양이 전자기기 회사' },
  { symbol: 'GSHIP', name: '가나디해운', initialPrice: 260, volatility: 0.045, risk: '중간', description: '낚시 아이템 운송 회사' },
  { symbol: 'CLOUD', name: '구름은행', initialPrice: 410, volatility: 0.04, risk: '중간', description: '가나디 월드의 가상 은행' },
  { symbol: 'BONE', name: '뼈다귀에너지', initialPrice: 550, volatility: 0.075, risk: '높음', description: '가나디 월드의 에너지 회사' },
  { symbol: 'DDE', name: '댕댕엔터', initialPrice: 180, volatility: 0.11, risk: '매우 높음', description: '강아지 아이돌 엔터 회사' },
  { symbol: 'MTECH', name: '말랑테크', initialPrice: 730, volatility: 0.08, risk: '높음', description: '가나디 월드의 IT 기업' },
  { symbol: 'DUCO', name: '듀상사', initialPrice: 290, volatility: 0.045, risk: '중간', description: '듀코인 유통과 상점을 운영하는 기업' }
]);

export const newsTemplates = Object.freeze([
  { title: '간식 시장 호황', category: '호황', text: '멍푸드의 신제품 바삭뼈다귀칩이 큰 인기를 얻고 있다멍!', stock: 'MFOOD', stockEffect: 0.08, itemMultiplier: 1.05, fishingMultiplier: 1 },
  { title: '갑작스러운 비구름', category: '불황', text: '거센 비구름으로 낚시 수확량과 운송량이 줄었다멍…', stock: 'GSHIP', stockEffect: -0.07, itemMultiplier: 1.1, fishingMultiplier: 0.92 },
  { title: '말랑 기술 박람회', category: '특정 기업 호재', text: '말랑테크가 새로운 발바닥 컴퓨터를 공개했다멍!', stock: 'MTECH', stockEffect: 0.1, itemMultiplier: 1, fishingMultiplier: 1 },
  { title: '캣닢 기기 리콜', category: '특정 기업 악재', text: '캣닢전자의 일부 제품이 리콜에 들어갔다멍.', stock: 'CATEL', stockEffect: -0.1, itemMultiplier: 1, fishingMultiplier: 1 },
  { title: '가나디 낚시 축제', category: '축제 이벤트', text: '가나디 월드 전역에서 낚시 축제가 열렸다멍!', stock: 'GSHIP', stockEffect: 0.06, itemMultiplier: 1.08, fishingMultiplier: 1.12 },
  { title: '간식 원료 품귀', category: '물가 상승', text: '뼈다귀 간식 원료가 부족해져 물가가 들썩이고 있다멍.', stock: 'BONE', stockEffect: 0.07, itemMultiplier: 1.12, fishingMultiplier: 1 },
  { title: '듀코인 절약 주간', category: '물가 하락', text: '가나디 월드 상점들이 할인 경쟁에 들어갔다멍!', stock: 'DUCO', stockEffect: -0.03, itemMultiplier: 0.92, fishingMultiplier: 1 },
  { title: '댕댕 아이돌 대흥행', category: '특정 기업 호재', text: '댕댕엔터의 새 아이돌 꼬리팡이 차트를 휩쓸었다멍!', stock: 'DDE', stockEffect: 0.14, itemMultiplier: 1, fishingMultiplier: 1 }
]);

export const dailyQuestDefinitions = Object.freeze([
  { key: 'attendance', label: '출석체크 하기', goal: 1 },
  { key: 'fishing', label: '낚시 5회 하기', goal: 5 },
  { key: 'sell', label: '아이템 3개 판매하기', goal: 3 },
  { key: 'news', label: '경제뉴스 1회 확인하기', goal: 1 },
  { key: 'stock_info', label: '주식 정보 1회 확인하기', goal: 1 },
  { key: 'mini_game', label: '미니게임 3회 참여하기', goal: 3 }
]);

export const weeklyQuestDefinitions = Object.freeze([
  { key: 'fishing', label: '낚시 30회 하기', goal: 30 },
  { key: 'sell', label: '아이템 50개 판매하기', goal: 50 },
  { key: 'stock_trade', label: '주식 거래 10회 하기', goal: 10 },
  { key: 'attendance', label: '출석체크 5회 하기', goal: 5 },
  { key: 'mini_game', label: '미니게임 20회 참여하기', goal: 20 }
]);

export function formatDuc(amount) {
  return `${Math.floor(Number(amount) || 0).toLocaleString('ko-KR')} ${currency.emoji}`;
}

export function getFishingItem(id, customItems = {}) {
  return fishingItems.find((item) => item.id === id) || customItems[id] || null;
}

export function getRod(id) {
  return rods.find((rod) => rod.id === id) || rods[0];
}

export function getShopItem(id) {
  return shopItems.find((item) => item.id === id) || null;
}

export function getVirtualStock(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  return virtualStocks.find((stock) => stock.symbol === normalized) || null;
}
