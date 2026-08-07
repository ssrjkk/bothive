import React from 'react';
import { Skeleton, Card } from 'antd';

export function PageSkeleton() {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <Skeleton.Input active size="large" style={{ width: 200, height: 26 }} />
          <div style={{ marginTop: 8 }}>
            <Skeleton.Input active size="small" style={{ width: 280, height: 13 }} />
          </div>
        </div>
        <Skeleton.Button active size="small" style={{ width: 130 }} />
      </div>
      <Card className="bh-card" variant="borderless">
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    </div>
  );
}
