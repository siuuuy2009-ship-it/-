# Vercel + Supabase 배포

이 저장소의 `vercel.json`이 Vercel용 화면 빌드와 저장 API를 설정합니다. 기존 Cloudflare/Sites 배포와 Windows 실행파일도 계속 사용할 수 있습니다. 이분 매칭과 업무 규칙은 모든 버전에서 공유합니다.

## 1. Supabase 준비

1. 조직은 `dasi-nanum`, 유형은 Personal, 요금제는 Free로 생성합니다.
2. 프로젝트를 만들고 데이터베이스 비밀번호를 따로 보관합니다. 지역은 Seoul을 선택할 수 있습니다.
3. 프로젝트가 Healthy가 되면 **Connect → Direct (Connection string)** 를 엽니다.
4. **Transaction pooler**를 선택하고 포트가 **6543**인 연결 주소를 복사합니다.
5. `[YOUR-PASSWORD]`를 데이터베이스 비밀번호로 바꿉니다. 비밀번호에 `@`, `#`, `%`, `/` 등의 문자가 있으면 비밀번호 부분을 URL 인코딩해야 합니다.

이 주소는 서버 비밀입니다. GitHub, 채팅, 공개 프런트엔드 환경변수에 올리지 말고 Vercel의 환경변수 값으로만 입력합니다. 화면에 표시되는 `https://…supabase.co` 프로젝트 URL이나 Publishable key는 `DATABASE_URL`이 아닙니다.

## 2. Vercel 설정

저장소 `siuuuy2009-ship-it/-`, 브랜치 `main`, 프로젝트 이름 `dasi-nanum`을 사용합니다.

| 항목 | 설정 |
| --- | --- |
| Root Directory | 비워 두어 저장소 최상위를 사용 (`app`, `web` 선택 금지) |
| Application / Framework Preset | Vite |
| Node.js Version | 24.x |
| Build / Install / Output | 저장소의 `vercel.json` 값 사용 |

`Settings → Environment Variables`에서 아래 값을 Production에 추가합니다.

| 이름 | 값 |
| --- | --- |
| `DATABASE_URL` | Supabase Transaction pooler 연결 주소 |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

Preview에서도 등록·저장을 시험하려면 Preview 환경에도 별도의 테스트용 데이터베이스 연결을 설정합니다.

이 저장소가 지정하는 실제 빌드 값은 다음과 같습니다. 기존 화면에 다른 Override가 남아 있다면 저장소 설정과 같게 맞춥니다.

- Install Command: `npx --yes pnpm@11.19.0 install --frozen-lockfile`
- Build Command: `node node_modules/vite/bin/vite.js build --config vite.vercel.config.ts`
- Output Directory: `vercel-build`

환경변수나 Root Directory를 바꾼 후에는 최신 커밋을 **Redeploy**해야 반영됩니다.

## 3. 저장과 확인

처음 자료를 불러올 때 앱이 비공개 `nanum_private` 스키마와 테이블을 만듭니다. SQL Editor에 따로 스키마를 복사할 필요가 없습니다. 프로젝트의 `postgres` 계정 연결을 사용합니다. 테이블에는 RLS를 켜고 공개 역할의 스키마 접근을 제한합니다. 브라우저는 Vercel API에만 요청하며 DB 연결 주소를 받지 않습니다.

- 첫 화면 404: Root Directory, 최신 배포의 커밋, Build/Output 설정을 확인합니다.
- “자료 저장소가 연결되지 않았어요”: Production의 `DATABASE_URL` 설정과 재배포 여부를 확인합니다.
- 저장소를 설정했는데 503: 비밀번호, URL 인코딩, pooler 호스트·6543 포트, Supabase Healthy 상태를 확인합니다.
- 인증서 오류가 확인된 경우: Supabase가 제공하는 DB 루트 인증서를 `DATABASE_CA_CERT` 환경변수에 넣고 재배포합니다. 인증서 검증을 끄지 않습니다.

자료는 각 브라우저의 쿠키로 구분됩니다. 다른 브라우저와 행사 자료가 자동으로 공유되는 구조는 아닙니다. 기존 Sites 또는 Windows 자료가 Supabase로 자동 이전되지는 않습니다.

## 개발 검증

`pnpm test`는 실제 PostgreSQL 엔진(PGlite)에서 저장, 서버 인스턴스 간 조회, 동시 수정 충돌, 매칭·전달, RLS와 비공개 접근 제한을 검사합니다. Supabase 네트워크 연결 자체는 배포 후 별도로 확인해야 합니다.

```sh
pnpm typecheck
pnpm test
pnpm build:vercel
```

배포 후 API 시연 검증은 `TEST_BASE_URL`에 배포 주소를 지정한 뒤 `pnpm test:api`로 실행할 수 있습니다. 새 쿠키의 별도 작업 공간에 가상 테스트 자료를 만들며 기존 사용자 자료는 수정하지 않습니다.

공식 안내: [Supabase 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres), [Vercel 빌드 설정](https://vercel.com/docs/builds/configure-a-build).
