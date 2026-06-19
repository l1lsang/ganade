# Discord 인증 역할 봇

수동 인증 티켓, 종교 역할 선택, MBTI 토글 역할을 제공하는 Discord 봇입니다. 인증은 사용자가 티켓을 만들고, 관리자 역할이 티켓 안에서 신분증 또는 학생증을 직접 확인한 뒤 승인하는 방식입니다.

## 준비

1. Discord Developer Portal에서 봇을 만들고 `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`를 준비합니다.
2. 서버에 초대할 때 OAuth2 scope는 `bot`, `applications.commands`를 선택합니다.
3. Bot 권한은 최소 `Manage Roles`, `Manage Channels`, `Create Expressions` 또는 `Manage Expressions`, `Use External Emojis`가 필요합니다.
4. 환영 메시지를 쓰려면 Discord Developer Portal의 Bot 설정에서 `Server Members Intent`를 켭니다.
5. 초대자 표시를 쓰려면 봇에 `Manage Server` 권한이 있어야 초대 목록을 읽을 수 있습니다.
6. 봇의 최고 역할을 봇이 지급하거나 생성할 역할보다 위로 올려야 합니다.
7. `.env.example`을 참고해서 `.env`를 만듭니다.

## 실행

```bash
npm install
npm run sync
npm start
```

`DISCORD_GUILD_ID`를 넣으면 서버 명령어로 빠르게 동기화됩니다. 실행 후 Discord에서 `/업데이트`를 사용하면 현재 서버 명령어를 다시 동기화할 수 있습니다. 전역 명령어가 필요하면 `/업데이트 범위:전역` 또는 `npm run sync:global`을 사용하세요.

서버 안에서 UI 패널을 쓰려면 `/인증패널`, `/종교패널`, `/mbti 설정`을 실행하세요. `/패널`을 실행하면 인증 패널과 종교 패널을 각각 따로 보냅니다.

## Render 배포

Render Web Service로 배포하면 봇이 `PORT` 환경변수 포트에서 health 서버를 함께 엽니다. Build Command는 `npm install`, Start Command는 `npm start`로 설정하세요. Health Check Path는 `/health`를 사용할 수 있습니다.

Discord 봇만 장시간 실행할 목적이라면 Render Background Worker로 배포하는 방식도 맞습니다. Web Service를 계속 사용할 경우에는 이 health 서버가 Render의 포트 감지 요구사항을 만족합니다.

Discord에서 `애플리케이션이 응답하지 않았어요`가 뜨면 Render 로그에서 아래 줄이 있는지 먼저 확인하세요.

```text
Health server listening on 0.0.0.0:<port>
<봇이름> 로그인 완료
```

두 번째 줄이 없으면 Discord 토큰, 봇 초대, 또는 gateway 연결 문제입니다. Render Free Web Service가 잠들면 Discord gateway도 끊기므로, 계속 켜져 있어야 하는 봇은 Background Worker 또는 잠들지 않는 인스턴스로 운영하는 편이 안정적입니다.

## 웹 설정 UI

Render 또는 로컬에서 열리는 웹사이트 `/`에서 환영 메시지를 설정할 수 있습니다. 공개 URL에 노출되는 관리자 화면이라 `.env` 또는 Render Environment Variables에 `WEB_ADMIN_TOKEN`을 반드시 넣으세요.

웹 UI에서 가능한 설정:

- 봇이 들어간 서버 선택
- 입장 로그 채널 선택
- 퇴장 로그 채널 선택
- 임베드 제목, 추가 메시지, 색상 설정
- 가입자/퇴장자 프로필 이미지 표시
- 가입자 멘션 포함 여부 설정
- 초대자 표시 여부 설정
- 외부 이모지 문자열 입력

외부 이모지는 Discord 형식 그대로 입력하면 됩니다. 단, 봇이 해당 이모지를 사용할 수 있어야 하므로 봇이 이모지가 있는 서버에 있거나, 대상 채널에서 `Use External Emojis` 권한이 있어야 합니다.

```text
<:emoji_name:123456789012345678>
<a:animated_name:123456789012345678>
```

외부 이모지를 서버에 복사하려면 `/이모지추가`를 사용하세요.

```text
/이모지추가 이모지:<:emoji_name:123456789012345678>
/이모지추가 이모지:<a:animated_name:123456789012345678>
/이모지추가 이모지:https://example.com/image.png 이름:my_emoji
/이모지추가 이미지:<첨부파일> 이름:my_emoji
```

이모지 이름은 Discord 제한 때문에 영문, 숫자, 밑줄만 사용할 수 있습니다.

사용 가능한 토큰:

- `{user}`: 가입자 이름
- `{tag}`: 가입자 태그
- `{mention}`: 가입자 멘션
- `{server}`: 서버 이름
- `{memberCount}`: 서버 멤버 수
- `{joinedAt}` / `{joinedRelative}`: 입장 시간
- `{leftAt}` / `{leftRelative}`: 퇴장 시간
- `{createdAt}` / `{createdRelative}`: 계정 생성 시간
- `{inviterMention}` / `{inviterName}` / `{inviterTag}`: 초대자 정보

## 명령어

- `/인증`: 수동 인증 티켓 생성
- `/인증패널 채널:<채널>`: 인증 티켓 생성 전용 패널 게시
- `/종교패널 채널:<채널>`: 종교 역할 선택 전용 패널 게시
- `/패널 채널:<채널>`: 인증 패널과 종교 역할 패널을 따로 게시
- `/설정 인증역할:<역할> 관리자역할:<역할> 로그채널:<채널>`: 인증 역할, 티켓 관리자 역할, 인증 로그 채널 설정
- `/mbti 설정 채널:<채널>`: MBTI 토글 버튼 패널 게시
- `/이모지추가 이모지:<외부이모지 또는 URL> 이미지:<첨부파일> 이름:<이름>`: 외부 이모지나 이미지를 서버 이모지로 추가
- `/핑`: 봇 응답 상태 확인
- `/종교선택 종교:<선택>`: 기존 종교 역할 지급
- `/종교선택 직접입력:<이름>`: 해당 종교 역할이 없으면 생성 후 지급
- `/업데이트`: 슬래시 명령어 동기화

`/설정`으로 저장한 값은 `.env`의 `VERIFIED_ROLE_ID`, `ADMIN_ROLE_ID`, `LOG_CHANNEL_ID`보다 우선 적용됩니다. 아무 옵션 없이 `/설정`을 실행하면 현재 설정을 확인할 수 있습니다.

## 인증 티켓

인증 패널의 `인증 티켓 생성` 버튼 또는 `/인증` 명령어를 사용하면 티켓 채널이 생성됩니다. 티켓은 기본적으로 티켓 생성자와 `/설정 관리자역할`로 지정한 역할만 볼 수 있습니다.

티켓 안 버튼:

- `인증 승인`: 관리자 역할만 사용할 수 있으며, 인증 역할을 지급합니다.
- `티켓 닫기`: 티켓 생성자 또는 관리자 역할이 사용할 수 있으며, 채널을 삭제합니다.

## MBTI 역할

`/mbti 설정 채널:<채널>`을 실행하면 I/E, N/S, T/F, J/P 토글 버튼이 있는 패널을 보냅니다. 사용자가 버튼을 누르면 `MBTI | I` 같은 역할을 자동 생성해 지급하고, 같은 축의 반대 역할은 제거합니다.

## 개인정보 처리 방향

봇은 신분증/학생증 이미지를 분석하거나 별도 파일로 저장하지 않습니다. 사용자가 티켓 채널에 올린 이미지는 관리자가 직접 확인합니다. 실제 운영 시 서버 규칙에 인증 이미지 처리 동의, 티켓 종료 후 채널 삭제 방침을 함께 안내하는 것을 권장합니다.
