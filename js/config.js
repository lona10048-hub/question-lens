// ════════════════════════════════════════════════
// 개발진이 채우는 곳 (GitHub에서 이 파일의 연필 버튼을 눌러 고쳐요)
// ════════════════════════════════════════════════

// 서버 주소: 개발진이 Apps Script로 배포한 4차시 전용 웹 앱 주소 (…/exec)
// 모든 선생님과 학생 태블릿이 이 서버 하나를 함께 써요. 선생님은 따로 준비할 것이 없어요.
// 비어 있으면 연습 모드(인터넷 없이 이 컴퓨터에서 미리 해 보기)로만 열려요.
export const SERVER_URL = 'https://script.google.com/macros/s/AKfycbxTqdUh9M_2CDaqlncg4lBQi155NJNceTj2SC4NyPL5pKcL_aEbQ7_kB7DbqkOErqV_/exec';

// ════════════════════════════════════════════════

export const APP_NAME = '렌즈로 여는 탐구 질문';

// 서버 규칙 (서버 코드 gas/Code.gs의 TTL_MS, LIMIT과 같게 맞춰 두세요)
export const SERVER_RULES = { keepHours: 24, gamesPerTeacher: 6 };

// 서버에 상태를 물어보는 간격 (밀리초). 학생이 한 명에 한 대씩이라, 학생 태블릿은 천천히 물어요.
//  server: 실제 서버, local: 연습 모드(이 컴퓨터 안)
export const POLL = {
  server: { teacher: 4000, student: 15000, studentDone: 30000, hidden: 30000, items: 4000, itemsSlow: 20000 },
  local: { teacher: 2000, student: 3000, studentDone: 8000, hidden: 10000, items: 2500, itemsSlow: 10000 },
};
