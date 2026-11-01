// 10단계 제작 3: 시험 계정 B의 가상 메모 한 건만 비공개 사본에서 복원합니다.
// 실제 복원·해시 대조·감사 기록은 DB 함수 public.restore_note_from_point가 한 트랜잭션에서 합니다.
import { createHash } from 'node:crypto';

// 복원 대상(공개 가능한 가상 메모). 내용 해시 = sha256(title + "\n" + content)
export const RESTORE_TARGET = Object.freeze({
  id: 'b4b4b4b4-0000-4000-8000-000000000001',
  title: 'B 시험 메모 (공개 가능한 가상 자료)',
  content: '4단계 소유권 격리 확인용 가상 메모입니다.',
  contentSha256: '43001f020a39ae0dd87914d5282b2b0560864e38ef02af144b396cf85f7e3676',
});

export const contentHash = (title, content) => createHash('sha256').update(`${title}\n${content}`, 'utf8').digest('hex');

export function supabaseRestorer(client) {
  return {
    async restore(id, actor) {
      const { data, error } = await client.rpc('restore_note_from_point',
        { p_note_id: id, p_actor_kind: actor.kind, p_actor_id: actor.id });
      if (error) throw Object.assign(new Error('restore'), { code: error.code });
      return data;
    },
  };
}
