import '@testing-library/jest-dom/vitest';
import React from 'react';
import { vi } from 'vitest';

// Set VITE_API_URL for tests to match the expected '/api' base path
vi.stubEnv('VITE_API_URL', '/api');

const messageApi = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };

vi.mock('antd', () => {
  const Alert = ({ message, description, type, showIcon, action, style }: any) =>
    React.createElement(
      'div',
      { 'data-testid': `alert-${type}`, style, role: 'alert' },
      showIcon && React.createElement('span', { 'data-testid': 'alert-icon' }),
      React.createElement('span', { 'data-testid': 'alert-message' }, message),
      description &&
        React.createElement('span', { 'data-testid': 'alert-description' }, description),
      action && React.createElement('span', { 'data-testid': 'alert-action' }, action),
    );

  const Button = ({
    children,
    onClick,
    size,
    icon,
    loading,
    htmlType,
    type,
    block,
    ...rest
  }: any) =>
    React.createElement(
      'button',
      { onClick, disabled: loading, type: htmlType || 'button', 'data-size': size, ...rest },
      children,
    );

  const Typography = {
    Title: ({ children, level, style, ...rest }: any) =>
      React.createElement(`h${level || 1}`, { style, ...rest }, children),
    Text: ({ children, style, type, ...rest }: any) =>
      React.createElement('span', { style, 'data-type': type, ...rest }, children),
    Paragraph: ({ children, style, ...rest }: any) =>
      React.createElement('p', { style, ...rest }, children),
    Link: ({ children, href, style, ...rest }: any) =>
      React.createElement('a', { href, style, ...rest }, children),
  };

  const Tag = ({ children, color, style, ...rest }: any) =>
    React.createElement('span', { 'data-color': color, style, ...rest }, children);

  const Skeleton = Object.assign(
    ({ active, paragraph, ...rest }: any) =>
      React.createElement('div', { 'data-testid': 'skeleton', ...rest }, 'skeleton'),
    {
      Input: (props: any) =>
        React.createElement('div', { 'data-testid': 'skeleton-input', ...props }),
      Button: (props: any) =>
        React.createElement('div', { 'data-testid': 'skeleton-button', ...props }),
      Avatar: (props: any) =>
        React.createElement('div', { 'data-testid': 'skeleton-avatar', ...props }),
    },
  );

  const Card = ({ children, title, extra, ...rest }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'card', ...rest },
      title && React.createElement('div', { 'data-testid': 'card-title' }, title),
      extra && React.createElement('div', { 'data-testid': 'card-extra' }, extra),
      children,
    );

  const ConfigProvider = ({ children }: any) => React.createElement(React.Fragment, null, children);

  const Table = ({ dataSource, columns, rowKey, loading, pagination, locale, ...rest }: any) => {
    const isEmpty = !dataSource || dataSource.length === 0;
    const emptyText = locale?.emptyText || rest.emptyText;
    return React.createElement(
      'table',
      { 'data-testid': 'table', 'data-loading': loading },
      React.createElement(
        'thead',
        null,
        React.createElement(
          'tr',
          null,
          (columns ?? []).map((col: any, i: number) =>
            React.createElement(
              'th',
              { key: i },
              typeof col.title === 'function' ? col.title() : col.title,
            ),
          ),
        ),
      ),
      React.createElement(
        'tbody',
        null,
        isEmpty && emptyText
          ? React.createElement(
              'tr',
              null,
              React.createElement('td', { colSpan: (columns ?? []).length }, emptyText),
            )
          : (dataSource ?? []).map((row: any, ri: number) =>
              React.createElement(
                'tr',
                { key: rowKey ? row[rowKey] : ri },
                (columns ?? []).map((col: any, ci: number) =>
                  React.createElement(
                    'td',
                    { key: ci },
                    col.render ? col.render(row[col.dataIndex], row, ri) : row[col.dataIndex],
                  ),
                ),
              ),
            ),
      ),
    );
  };

  const formInstance = {
    setFieldsValue: vi.fn(),
    resetFields: vi.fn(),
    validateFields: vi.fn().mockResolvedValue({}),
    getFieldsValue: vi.fn().mockReturnValue({}),
    setFieldValue: vi.fn(),
    getFieldValue: vi.fn(),
  };

  const Form = Object.assign(
    ({ children, onFinish, layout, autoComplete, ...rest }: any) => {
      const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget as HTMLFormElement);
        const values: Record<string, string> = {};
        formData.forEach((v, k) => {
          values[k] = v as string;
        });
        onFinish?.(values);
      };
      return React.createElement(
        'form',
        { onSubmit: handleSubmit, 'data-layout': layout, autoComplete, ...rest },
        children,
      );
    },
    {
      Item: ({ children, name, label, rules, valuePropName, ...rest }: any) =>
        React.createElement(
          'div',
          { 'data-testid': `form-item-${name}`, ...rest },
          label && React.createElement('label', { htmlFor: name }, label),
          React.Children.map(children, (child: any) => {
            if (!child || !child.type) return child;
            return React.cloneElement(child, { name, id: name });
          }),
        ),
      useForm: () => [formInstance],
      useWatch: () => undefined,
    },
  );

  const Input = Object.assign(
    ({ prefix, placeholder, size, name, value, onChange, style, allowClear, ...rest }: any) =>
      React.createElement('input', {
        placeholder,
        name,
        value,
        onChange,
        style,
        'data-testid': `input-${name || 'text'}`,
        ...rest,
      }),
    {
      Password: ({ prefix, placeholder, size, name, value, onChange, ...rest }: any) =>
        React.createElement('input', {
          type: 'password',
          placeholder,
          name,
          value,
          onChange,
          'data-testid': `input-${name || 'password'}`,
          ...rest,
        }),
      Search: ({ placeholder, onChange, value, style, allowClear, ...rest }: any) =>
        React.createElement('input', {
          type: 'search',
          placeholder,
          onChange,
          value,
          style,
          'data-testid': 'input-search',
          ...rest,
        }),
      TextArea: ({ placeholder, value, onChange, rows, name, ...rest }: any) =>
        React.createElement('textarea', {
          placeholder,
          value,
          onChange,
          rows,
          name,
          'data-testid': `textarea-${name || 'text'}`,
          ...rest,
        }),
    },
  );

  const Select = ({
    value,
    onChange,
    options,
    placeholder,
    style,
    allowClear,
    showSearch,
    mode,
    ...rest
  }: any) =>
    React.createElement(
      'select',
      {
        value: value ?? '',
        onChange: (e: any) => onChange?.(e.target.value || undefined),
        'data-testid': rest['data-testid'] || 'select',
        style,
      },
      React.createElement('option', { value: '' }, placeholder || 'Select...'),
      (options ?? []).map((opt: any) =>
        React.createElement('option', { key: opt.value, value: opt.value }, opt.label),
      ),
    );

  const Switch = ({ checked, onChange, ...rest }: any) =>
    React.createElement('input', {
      type: 'checkbox',
      checked,
      onChange: (e: any) => onChange?.(e.target.checked),
      'data-testid': 'switch',
      ...rest,
    });

  const Modal = Object.assign(
    ({ children, open, title, onOk, onCancel, footer, confirmLoading, ...rest }: any) =>
      open
        ? React.createElement(
            'div',
            { 'data-testid': 'modal', role: 'dialog' },
            title && React.createElement('div', { 'data-testid': 'modal-title' }, title),
            React.createElement('div', null, children),
            footer !== null &&
              React.createElement(
                'div',
                { 'data-testid': 'modal-footer' },
                footer ||
                  React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(
                      'button',
                      { onClick: onCancel, 'data-testid': 'modal-cancel' },
                      'Cancel',
                    ),
                    React.createElement(
                      'button',
                      { onClick: onOk, 'data-testid': 'modal-ok' },
                      'OK',
                    ),
                  ),
              ),
          )
        : null,
    {
      confirm: vi.fn(),
    },
  );

  const Tabs = ({ items, activeKey, onChange, centered, ...rest }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'tabs', ...rest },
      React.createElement(
        'div',
        { 'data-testid': 'tab-bar' },
        (items ?? []).map((item: any) =>
          React.createElement(
            'button',
            {
              key: item.key,
              'data-tab': item.key,
              'data-active': activeKey === item.key ? '' : undefined,
              onClick: () => onChange?.(item.key),
            },
            item.label,
          ),
        ),
      ),
      (items ?? []).map((item: any) =>
        React.createElement('div', { key: item.key, 'data-tab-panel': item.key }, item.children),
      ),
    );

  const Space = ({ children, ...rest }: any) =>
    React.createElement('div', { 'data-testid': 'space', ...rest }, children);

  const Badge = ({ status, text, count, ...rest }: any) =>
    React.createElement('span', { 'data-testid': 'badge', 'data-status': status, ...rest }, text);

  const Popconfirm = ({ children, title, onConfirm, onCancel, ...rest }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'popconfirm', ...rest },
      children,
      React.createElement('button', { onClick: onConfirm, 'data-testid': 'popconfirm-ok' }, 'OK'),
      React.createElement(
        'button',
        { onClick: onCancel, 'data-testid': 'popconfirm-cancel' },
        'Cancel',
      ),
    );

  const Tooltip = ({ children, title, ...rest }: any) =>
    React.createElement('span', { title, ...rest }, children);

  const Progress = ({ percent, format, status, ...rest }: any) =>
    React.createElement('div', { 'data-testid': 'progress', 'data-percent': percent, ...rest });

  const Drawer = ({ children, open, title, onClose, ...rest }: any) =>
    open
      ? React.createElement(
          'div',
          { 'data-testid': 'drawer', role: 'dialog', ...rest },
          title && React.createElement('div', null, title),
          React.createElement(
            'button',
            { onClick: onClose, 'data-testid': 'drawer-close' },
            'Close',
          ),
          children,
        )
      : null;

  const Segmented = ({ value, onChange, options, ...rest }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'segmented', ...rest },
      (options ?? []).map((opt: any) =>
        React.createElement(
          'button',
          {
            key: opt.value ?? opt,
            'data-selected': (opt.value ?? opt) === value ? '' : undefined,
            onClick: () => onChange?.(opt.value ?? opt),
          },
          opt.label ?? opt,
        ),
      ),
    );

  const InputNumber = ({ value, onChange, min, max, style, ...rest }: any) =>
    React.createElement('input', {
      type: 'number',
      value,
      onChange: (e: any) => onChange?.(Number(e.target.value)),
      min,
      max,
      style,
      'data-testid': 'input-number',
      ...rest,
    });

  const Descriptions = Object.assign(
    ({ children, column, colon, ...rest }: any) =>
      React.createElement('div', { 'data-testid': 'descriptions', ...rest }, children),
    {
      Item: ({ children, label, ...rest }: any) =>
        React.createElement(
          'div',
          { 'data-testid': 'descriptions-item', ...rest },
          label && React.createElement('span', { 'data-testid': 'descriptions-item-label' }, label),
          React.createElement('span', { 'data-testid': 'descriptions-item-content' }, children),
        ),
    },
  );

  const Empty = Object.assign(
    ({ image, description, children, ...rest }: any) =>
      React.createElement(
        'div',
        { 'data-testid': 'empty', ...rest },
        description &&
          React.createElement('div', { 'data-testid': 'empty-description' }, description),
        children,
      ),
    {
      PRESENTED_IMAGE_SIMPLE: 'simple',
    },
  );

  const Row = ({ children, ...rest }: any) =>
    React.createElement('div', { 'data-testid': 'row', ...rest }, children);

  const Col = ({ children, ...rest }: any) =>
    React.createElement('div', { 'data-testid': 'col', ...rest }, children);

  const Spin = ({ children, spinning, ...rest }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'spin', 'data-spinning': spinning, ...rest },
      children,
    );

  const Upload = Object.assign(
    ({ children, ...rest }: any) =>
      React.createElement('div', { 'data-testid': 'upload', ...rest }, children),
    {
      Dragger: ({ children, ...rest }: any) =>
        React.createElement('div', { 'data-testid': 'upload-dragger', ...rest }, children),
    },
  );

  const Divider = ({ ...rest }: any) =>
    React.createElement('hr', { 'data-testid': 'divider', ...rest });

  const Statistic = ({ title, value, ...rest }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'statistic', ...rest },
      title && React.createElement('div', { 'data-testid': 'statistic-title' }, title),
      React.createElement('div', { 'data-testid': 'statistic-value' }, value),
    );

  const theme = {
    useToken: () => ({
      token: {
        colorTextSecondary: '#888',
        colorPrimary: '#1677ff',
        colorBorderSecondary: 'rgba(0,0,0,0.1)',
        colorBgLayout: '#f5f5f5',
        borderRadius: 6,
      },
    }),
    darkAlgorithm: Symbol('darkAlgorithm'),
    defaultAlgorithm: Symbol('defaultAlgorithm'),
  };

  return {
    Alert,
    Button,
    Typography,
    Tag,
    Skeleton,
    Card,
    ConfigProvider,
    Table,
    Form,
    Input,
    Select,
    Switch,
    Modal,
    Tabs,
    Space,
    Badge,
    Popconfirm,
    Tooltip,
    Progress,
    Drawer,
    Segmented,
    InputNumber,
    Descriptions,
    Empty,
    Row,
    Col,
    Spin,
    Upload,
    Divider,
    Statistic,
    theme,
    message: messageApi,
  };
});

vi.mock('@ant-design/icons', () => {
  const icon = (name: string) => (props: any) =>
    React.createElement('span', { 'data-testid': name, ...props });
  return {
    ApiOutlined: icon('ApiOutlined'),
    ArrowLeftOutlined: icon('ArrowLeftOutlined'),
    BarChartOutlined: icon('BarChartOutlined'),
    CheckCircleOutlined: icon('CheckCircleOutlined'),
    CheckOutlined: icon('CheckOutlined'),
    CloseCircleOutlined: icon('CloseCircleOutlined'),
    CodeOutlined: icon('CodeOutlined'),
    CopyOutlined: icon('CopyOutlined'),
    DashboardOutlined: icon('DashboardOutlined'),
    DatabaseOutlined: icon('DatabaseOutlined'),
    DeleteOutlined: icon('DeleteOutlined'),
    DownloadOutlined: icon('DownloadOutlined'),
    EditOutlined: icon('EditOutlined'),
    FileTextOutlined: icon('FileTextOutlined'),
    InfoCircleOutlined: icon('InfoCircleOutlined'),
    LockOutlined: icon('LockOutlined'),
    LogoutOutlined: icon('LogoutOutlined'),
    MailOutlined: icon('MailOutlined'),
    MenuFoldOutlined: icon('MenuFoldOutlined'),
    MenuUnfoldOutlined: icon('MenuUnfoldOutlined'),
    MoonOutlined: icon('MoonOutlined'),
    PauseCircleOutlined: icon('PauseCircleOutlined'),
    PlayCircleOutlined: icon('PlayCircleOutlined'),
    PlusOutlined: icon('PlusOutlined'),
    ReloadOutlined: icon('ReloadOutlined'),
    RobotOutlined: icon('RobotOutlined'),
    RocketOutlined: icon('RocketOutlined'),
    SendOutlined: icon('SendOutlined'),
    SettingOutlined: icon('SettingOutlined'),
    SunOutlined: icon('SunOutlined'),
    TeamOutlined: icon('TeamOutlined'),
    ThunderboltOutlined: icon('ThunderboltOutlined'),
    UploadOutlined: icon('UploadOutlined'),
    UserAddOutlined: icon('UserAddOutlined'),
    UserOutlined: icon('UserOutlined'),
    WarningOutlined: icon('WarningOutlined'),
  };
});

export { messageApi };
