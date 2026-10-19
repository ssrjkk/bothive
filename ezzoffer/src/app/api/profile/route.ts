import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db, getUserByEmail } from '@/lib/db';
import { hashPassword, verifyPassword, SESSION_COOKIE } from '@/lib/auth';
import { isUniqueViolation } from '@/lib/http';

export async function PUT(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await readJson<{
    name?: string;
    email?: string;
    password?: string;
    currentPassword?: string;
    salaryExpectation?: number | null;
    cityPreference?: string;
  }>(request);
  if (error) return error;

  /*
   * Зарплатные ожидания и город.
   *
   * Поля добавлены вместе с фактором «Зарплата» в оценке вакансий: без них
   * пользователь не мог сказать сервису, что ищет, и подсказка «вакансия
   * ниже ваших ожиданий» была физически невозможна.
   *
   * Пустое значение сохраняется как NULL, а не как 0: «ожиданий не назвал» и
   * «ожидает ноль» — разные вещи, и при нуле любая вакансия проходила бы как
   * «выше ожиданий».
   */
  if (data && 'salaryExpectation' in data) {
    const raw = data.salaryExpectation;
    if (raw === null || raw === undefined) {
      db.prepare('UPDATE users SET salary_expectation = NULL WHERE id = ?').run(user.id);
    } else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100_000_000) {
        return NextResponse.json(
          { error: 'Зарплатные ожидания должны быть числом от 0 до 100 000 000' },
          { status: 400 },
        );
      }
      db.prepare('UPDATE users SET salary_expectation = ? WHERE id = ?').run(
        Math.round(value),
        user.id,
      );
    }
  }

  if (data && typeof data.cityPreference === 'string') {
    const city = data.cityPreference.trim();
    if (city.length > 80) {
      return NextResponse.json(
        { error: 'Название города слишком длинное (до 80 символов)' },
        { status: 400 },
      );
    }
    db.prepare('UPDATE users SET city_preference = ? WHERE id = ?').run(city, user.id);
  }

  const name = (data?.name ?? '').trim();
  if (name && name.length > 0) {
    if (name.length > 60) {
      return NextResponse.json({ error: 'Имя слишком длинное (до 60 символов)' }, { status: 400 });
    }
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
  }

  const email = data?.email?.trim().toLowerCase();
  if (email && email !== user.email) {
    if (!email || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Некорректный email' }, { status: 400 });
    }
    // Смена email — чувствительная операция: требуем подтверждение текущим паролем.
    const currentPassword = data?.currentPassword ?? '';
    if (!currentPassword || !(await verifyPassword(currentPassword, user.password_hash))) {
      return NextResponse.json(
        { error: 'Для смены email укажите текущий пароль' },
        { status: 403 },
      );
    }
    if (getUserByEmail(email)) {
      return NextResponse.json({ error: 'Этот email уже занят' }, { status: 409 });
    }
    try {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return NextResponse.json({ error: 'Этот email уже занят' }, { status: 409 });
      }
      throw err;
    }
  }

  const password = data?.password ?? '';
  if (password.length > 0) {
    if (password.length < 6 || password.length > 100) {
      return NextResponse.json(
        { error: 'Пароль должен быть от 6 до 100 символов' },
        { status: 400 },
      );
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      await hashPassword(password),
      user.id,
    );
    // Смена пароля инвалидирует остальные сессии (кроме текущей), включая украденные.
    const store = await cookies();
    const currentToken = store.get(SESSION_COOKIE)?.value;
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(
      user.id,
      currentToken ?? '',
    );
  }

  return Response.json({ ok: true });
}
