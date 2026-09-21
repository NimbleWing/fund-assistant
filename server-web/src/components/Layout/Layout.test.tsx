import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Layout } from '.';

const TABS = [
  { key: 'status', label: '服务状态' },
  { key: 'records', label: '买卖分析' },
] as const;

describe('Layout', () => {
  it('渲染标题、补充信息与内容', () => {
    render(
      <Layout title="基金助手" headerExtra="服务在线">
        <div>内容区</div>
      </Layout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: '基金助手' })).toBeTruthy();
    expect(screen.getByText('服务在线')).toBeTruthy();
    expect(screen.getByText('内容区')).toBeTruthy();
  });

  it('渲染标签栏：选中态与切换回调', () => {
    const onTabChange = vi.fn();
    render(
      <Layout title="t" tabs={TABS} activeTab="status" onTabChange={onTabChange}>
        <div />
      </Layout>,
    );
    expect(screen.getByRole('button', { name: '服务状态' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '买卖分析' }).getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '买卖分析' }));
    expect(onTabChange).toHaveBeenCalledWith('records');
  });

  it('无 tabs 时不渲染标签栏', () => {
    render(
      <Layout title="t">
        <div />
      </Layout>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('无 headerExtra 时不渲染补充信息占位', () => {
    render(
      <Layout title="t">
        <div />
      </Layout>,
    );
    expect(document.querySelector('header span')).toBeNull();
  });

  it('收合切换：按钮切换 data-collapsed 并持久化 localStorage', () => {
    localStorage.removeItem('side-nav-collapsed');
    render(
      <Layout title="t" tabs={TABS} activeTab="status">
        <div />
      </Layout>,
    );
    const nav = document.querySelector('nav');
    expect(nav?.getAttribute('data-collapsed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '收合侧边栏' }));
    expect(nav?.getAttribute('data-collapsed')).toBe('true');
    expect(nav?.className).toContain('lg:w-[76px]');
    expect(localStorage.getItem('side-nav-collapsed')).toBe('1');
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));
    expect(nav?.getAttribute('data-collapsed')).toBe('false');
    expect(localStorage.getItem('side-nav-collapsed')).toBe('0');
  });

  it('初始状态读自 localStorage', () => {
    localStorage.setItem('side-nav-collapsed', '1');
    render(
      <Layout title="t" tabs={TABS}>
        <div />
      </Layout>,
    );
    expect(document.querySelector('nav')?.getAttribute('data-collapsed')).toBe('true');
    localStorage.removeItem('side-nav-collapsed');
  });
});
