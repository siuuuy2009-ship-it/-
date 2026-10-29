'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Camera, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ClassroomDemo,
  DEMO_STAGES,
  type DemoStage,
} from '@/lib/classroom-demo';
import NanumApp from './nanum-app';

export default function ClassroomDemoApp({ onExit }: { onExit: () => void }) {
  const [scene, setScene] = useState(() => ({
    store: new ClassroomDemo(),
    stage: 'open' as DemoStage,
    version: 0,
  }));
  const [actorId, setActorId] = useState('demo-admin');
  const user = scene.store.users.find((p) => p.id === actorId)!;
  const workspace = useMemo(
    () => scene.store.client(user),
    [scene.store, user],
  );
  const stage = DEMO_STAGES.find((p) => p.value === scene.stage)!;
  function reset(next: DemoStage) {
    setScene((previous) => ({
      store: new ClassroomDemo(next),
      stage: next,
      version: previous.version + 1,
    }));
  }
  return (
    <>
      <section className="demo-studio" aria-label="보고서용 가상 시연">
        <div className="demo-studio-heading">
          <div>
            <p>
              <Camera size={18} /> 보고서용 가상 시연
            </p>
            <h1>여섯 학생의 나눔을 둘러보세요</h1>
          </div>
          <Button variant="outline" onClick={onExit}>
            <ArrowLeft size={16} /> 실제 나눔함으로
          </Button>
        </div>
        <p className="demo-studio-notice">
          모든 이름·학번·나눔 기록은 가상 예시입니다. 아래 선택은 로그인 없이
          화면을 체험하는 기능이며, 실제 계정이나 학교 자료에는 반영되지
          않습니다.
        </p>
        <div className="demo-studio-controls">
          <label>
            화면을 볼 사람
            <select
              value={actorId}
              onChange={(event) => setActorId(event.target.value)}
              aria-label="가상 사용자 선택"
            >
              {scene.store.users.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.role === 'student' ? ` · ${p.loginId}` : ''}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="demo-stage-buttons" aria-label="나눔 진행 장면">
            {DEMO_STAGES.map((p) => (
              <Button
                key={p.value}
                variant={p.value === scene.stage ? 'default' : 'outline'}
                aria-pressed={p.value === scene.stage}
                onClick={() => reset(p.value)}
              >
                {p.label}
              </Button>
            ))}
            <Button variant="ghost" onClick={() => reset(scene.stage)}>
              <RotateCcw size={15} /> 이 장면 초기화
            </Button>
          </fieldset>
        </div>
        <p className="demo-stage-description">
          {stage.description} 장면을 선택하면 해당 예시로 초기화됩니다.
        </p>
        <p className="demo-actor">
          <strong>{user.name}</strong> ·{' '}
          {user.role === 'admin' ? '운영자 화면' : `${user.loginId} 학생 화면`}{' '}
          · 이 페이지를 닫으면 시연 중 변경한 내용은 사라집니다.
        </p>
      </section>
      <NanumApp
        key={`${scene.version}:${user.id}`}
        user={user}
        workspace={workspace}
        initialTab={scene.stage === 'open' ? 'items' : 'matching'}
      />
    </>
  );
}
