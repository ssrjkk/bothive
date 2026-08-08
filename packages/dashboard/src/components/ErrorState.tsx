import React from 'react';
import { Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const text =
    typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);

  return (
    <Alert
      type="error"
      showIcon
      message="Something went wrong"
      description={text || 'An unexpected error occurred.'}
      action={
        onRetry ? (
          <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
      style={{ marginTop: 24, maxWidth: 720 }}
    />
  );
}
