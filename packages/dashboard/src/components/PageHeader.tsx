import React from 'react';
import { Typography, theme } from 'antd';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
}

export function PageHeader({ title, description, extra }: PageHeaderProps) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 20,
      }}
    >
      <div>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 21 }}>
          {title}
        </Typography.Title>
        {description && (
          <Typography.Text style={{ color: token.colorTextSecondary, fontSize: 13 }}>
            {description}
          </Typography.Text>
        )}
      </div>
      {extra && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{extra}</div>}
    </div>
  );
}
