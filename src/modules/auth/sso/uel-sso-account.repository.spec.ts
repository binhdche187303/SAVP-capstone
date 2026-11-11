import { UelSsoAccountRepository } from './uel-sso-account.repository';

/** dataSource.query giả: trả rows theo thứ tự gọi, ghi lại tham số. */
function build(...results: Array<Array<{ id: string }>>) {
  const query = jest.fn<Promise<Array<{ id: string }>>, [string, unknown[]]>(
    () => Promise.resolve(results.shift() ?? []),
  );
  const repo = new UelSsoAccountRepository({ query } as never);
  return { repo, query };
}

describe('UelSsoAccountRepository', () => {
  it('khớp theo mã SV trước', async () => {
    const { repo, query } = build([{ id: 'u1' }]);
    await expect(
      repo.findLinkedUser({ studentId: ' K254061001 ', userName: 'x' }),
    ).resolves.toEqual({
      kind: 'linked',
      userId: 'u1',
      matchedBy: 'student_code',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(['K254061001']);
  });

  it('chỉ có username (từ verify) ⇒ so với mã SV / mã cán bộ', async () => {
    const { repo, query } = build([{ id: 'u2' }]);
    await expect(repo.findLinkedUser({ userName: 'NS003' })).resolves.toEqual({
      kind: 'linked',
      userId: 'u2',
      matchedBy: 'username_code',
    });
    expect(query.mock.calls[0][1]).toEqual(['NS003']);
  });

  it('username không khớp mã ⇒ thử email', async () => {
    const { repo, query } = build([], [{ id: 'u3' }]);
    await expect(
      repo.findLinkedUser({ userName: 'nguyenvana', email: 'A@UEL.edu.vn' }),
    ).resolves.toEqual({ kind: 'linked', userId: 'u3', matchedBy: 'email' });
    expect(query.mock.calls[1][1]).toEqual(['a@uel.edu.vn']);
  });

  it('username dạng email ⇒ dùng làm email, không so với mã', async () => {
    const { repo, query } = build([{ id: 'u4' }]);
    await expect(
      repo.findLinkedUser({ userName: 'GV@uel.edu.vn', emailVerified: true }),
    ).resolves.toEqual({ kind: 'linked', userId: 'u4', matchedBy: 'email' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(['gv@uel.edu.vn']);
  });

  it('email chưa xác thực ⇒ không dùng email', async () => {
    const { repo, query } = build();
    await expect(
      repo.findLinkedUser({ email: 'a@uel.edu.vn', emailVerified: false }),
    ).resolves.toEqual({ kind: 'not_found' });
    expect(query).not.toHaveBeenCalled();
  });

  it('username khớp > 1 tài khoản ⇒ ambiguous', async () => {
    const { repo } = build([{ id: 'u1' }, { id: 'u2' }]);
    await expect(repo.findLinkedUser({ userName: 'K1' })).resolves.toEqual({
      kind: 'ambiguous',
      matchedBy: 'username_code',
    });
  });
});
