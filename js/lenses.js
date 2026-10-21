// 4차시 내용: 개념적 렌즈 8가지, 연습 그림, 한도
// 렌즈의 이름 · 뜻 · 질문 틀 · 예시를 바꾸려면 이 파일만 고치면 돼요. (예시 주제: 쓰레기)

export const LENS_EXAMPLE_TOPIC = '쓰레기';

export const DEFAULT_LENSES = [
  {
    id: 'form',
    name: '형태',
    desc: '어떻게 생겼고 어떤 특징이 있는지 살펴봐요',
    frames: ['○○은 어떻게 생겼을까?', '○○은 어떤 특징이 있을까?'],
    example: '우리 반에서 나오는 쓰레기에는 어떤 특징이 있을까?',
    color: { main: '#8fb8e8', soft: '#e3eefb', ink: '#2d5687' },
  },
  {
    id: 'function',
    name: '기능',
    desc: '어떻게 작동하고 어디에 쓰이는지 살펴봐요',
    frames: ['○○은 어떻게 작동할까?', '○○은 어떤 쓰임이 있을까?'],
    example: '재활용은 어떻게 작동할까?',
    color: { main: '#9cc877', soft: '#e6f2da', ink: '#3d6b26' },
  },
  {
    id: 'cause',
    name: '인과관계',
    desc: '왜 그런지, 그래서 어떤 일이 생기는지 살펴봐요',
    frames: ['○○의 이유는 무엇일까?', '○○ 때문에 어떤 일이 생길까?'],
    example: '쓰레기가 계속 늘어나면 어떤 일이 생길까?',
    color: { main: '#ee9a73', soft: '#fce4d7', ink: '#8a4426' },
  },
  {
    id: 'change',
    name: '변화',
    desc: '어떻게 달라져 왔고 앞으로 어떻게 달라질지 살펴봐요',
    frames: ['○○은 어떻게 변했을까?', '○○은 앞으로 어떻게 변할까?'],
    example: '쓰레기를 버리는 방법은 예전과 어떻게 변했을까?',
    color: { main: '#f2cc5c', soft: '#fdf3cf', ink: '#7a5a10' },
  },
  {
    id: 'connection',
    name: '연결성',
    desc: '다른 것과 어떻게 이어져 있는지 살펴봐요',
    frames: ['○○은 무엇과 관련 있을까?', '○○과 △△은 어떻게 관련되어 있을까?'],
    example: '쓰레기는 우리의 물건 사는 습관과 어떻게 관련되어 있을까?',
    color: { main: '#b7a3e0', soft: '#ede7f8', ink: '#4f3d85' },
  },
  {
    id: 'perspective',
    name: '관점',
    desc: '사람마다 어떻게 다르게 보는지 살펴봐요',
    frames: ['○○에 대한 다른 관점은 무엇일까?', '△△의 관점에서는 ○○을 어떻게 생각할까?'],
    example: '환경미화원의 관점에서는 쓰레기 문제를 어떻게 생각할까?',
    color: { main: '#7fcfc2', soft: '#dcf2ee', ink: '#23665b' },
  },
  {
    id: 'responsibility',
    name: '책임',
    desc: '누가 무엇을 해야 하는지 살펴봐요',
    frames: ['○○을 위해 우리는 무엇을 해야 할까?', '○○에서 누구에게 어떤 역할(의무)이 있을까?'],
    example: '쓰레기를 줄이기 위해 우리는 무엇을 해야 할까?',
    color: { main: '#e99bb5', soft: '#f9e1ea', ink: '#8a3555' },
  },
  {
    id: 'identity',
    name: '정체성',
    desc: '무엇이 그것을 그것답게 만드는지 살펴봐요',
    frames: ['○○을 ○○답게 만드는 것은 무엇일까?', '나(우리)에게 ○○은 어떤 의미일까?'],
    example: '나에게 환경 보호는 어떤 의미일까?',
    color: { main: '#c9a27a', soft: '#f3e6d7', ink: '#6b4a2a' },
  },
];

// 선생님이 추가하는 렌즈의 색 (차례대로)
export const CUSTOM_COLORS = [
  { main: '#a3c4bc', soft: '#e4efec', ink: '#3b5e56' },
  { main: '#d4a5a5', soft: '#f6e6e6', ink: '#7a3d3d' },
  { main: '#b5c99a', soft: '#ebf1e2', ink: '#4c5f33' },
  { main: '#f2b880', soft: '#fdeedd', ink: '#87511b' },
  { main: '#9fb4c7', soft: '#e5ecf2', ink: '#36506a' },
  { main: '#c3b1e1', soft: '#efe9f8', ink: '#55437a' },
  { main: '#e4c1f9', soft: '#f8edfe', ink: '#6a3f86' },
  { main: '#a9def9', soft: '#e7f6fe', ink: '#245e7c' },
];

export const NO_LENS = { id: '', name: '렌즈 없음', color: { main: '#d9cdb8', soft: '#f6f1e7', ink: '#6b5b45' } };

// 1차시와 같은 연습 그림 (선생님이 더 추가할 수 있어요)
export const BUILTIN_PICTURES = [
  { id: 'bus-stop', title: '잎사귀 우산 정류장', hint: '비 오는 날, 혼자 커다란 잎을 쓴 아이', src: 'assets/photos/bus-stop.jpg', thumb: 'assets/photos/bus-stop-thumb.jpg' },
  { id: 'sunflower', title: '창밖의 거대한 해바라기', hint: '어떤 아이들만 창밖을 보고 있는 교실', src: 'assets/photos/sunflower.jpg', thumb: 'assets/photos/sunflower-thumb.jpg' },
  { id: 'suitcase', title: '놀이터의 여행 가방', hint: '아무도 없는 놀이터에 놓인 오래된 가방', src: 'assets/photos/suitcase.jpg', thumb: 'assets/photos/suitcase-thumb.jpg' },
];

export const LIMITS = {
  title: 30,
  intro: 80,
  perStudent: 20,
  text: 100,
  name: 8,
  materials: 20,
  images: 30, // 이미지 + PDF 쪽 + 추가 연습 그림
  pdfPages: 10,
  textChars: 3000,
  tableRows: 30,
  tableCols: 8,
  cell: 40,
  matTitle: 40,
  customLenses: 8,
  customPictures: 5,
  lensName: 10,
  lensDesc: 40,
  lensFrame: 40,
  lensExample: 60,
};

// 자료 종류
export const MAT_KINDS = {
  text: { name: '글', icon: 'text' },
  image: { name: '이미지', icon: 'image' },
  pdf: { name: 'PDF', icon: 'pdf' },
  table: { name: '표', icon: 'table' },
  video: { name: '영상', icon: 'video' },
  link: { name: '링크', icon: 'link' },
};

export function lensById(lenses, id) {
  if (!id) return NO_LENS;
  return (lenses || []).find((l) => l.id === id) || DEFAULT_LENSES.find((l) => l.id === id) || { ...NO_LENS, id, name: id };
}

// 질문 틀에서 처음 바꿔 쓸 자리(○○ 또는 △△)를 찾는다
export function firstBlank(text) {
  const m = /○○|△△/.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

export function uid(prefix = '') {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return prefix + [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}
