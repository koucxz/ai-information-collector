import { Empty, Input, Modal, Tag } from 'antd';
import { ChevronRight } from 'lucide-react';
import { formatTime } from '../shared/format';
import type { Digest, EditingValue, EventDetail } from '../shared/types';

type AppModalsProps = {
  editing: EditingValue | null;
  editValue: string;
  eventDetail: EventDetail | null;
  digest: Digest | null;
  onEditValueChange: (value: string) => void;
  onSaveEdit: () => void;
  onCloseEdit: () => void;
  onCloseEvent: () => void;
  onCloseDigest: () => void;
};

export function AppModals(props: AppModalsProps) {
  return (
    <>
      <Modal
        title={props.editing?.kind === 'topic' ? '编辑主题' : '编辑关键词'}
        open={Boolean(props.editing)}
        okText="保存"
        cancelText="取消"
        onOk={props.onSaveEdit}
        onCancel={props.onCloseEdit}
        okButtonProps={{ disabled: !props.editValue.trim(), 'aria-label': '保存修改' }}
      >
        <Input autoFocus value={props.editValue} onChange={(event) => props.onEditValueChange(event.target.value)} onPressEnter={props.onSaveEdit} />
      </Modal>

      <Modal title={props.eventDetail?.title} open={Boolean(props.eventDetail)} footer={null} width={640} onCancel={props.onCloseEvent}>
        {props.eventDetail && (
          <div className="detail-modal">
            <p>首次发现 {formatTime(props.eventDetail.firstSeenAt)} · 最近更新 {formatTime(props.eventDetail.lastSeenAt)} · {props.eventDetail.sourceCount} 个来源</p>
            <div className="modal-list">
              {props.eventDetail.sources.map((source) => (
                <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                  <span className={'source-label source-' + source.source}>{source.sourceName}</span>
                  <strong>{source.title}</strong>
                  <ChevronRight size={14} />
                </a>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal title={props.digest?.title ?? '今日摘要'} open={Boolean(props.digest)} footer={null} width={680} onCancel={props.onCloseDigest}>
        {props.digest && (
          <div className="detail-modal digest-modal">
            <p>共 {props.digest.total} 条 · 未读 {props.digest.unread} 条 · 内容变化 {props.digest.changes} 条</p>
            <div className="digest-sources">
              {Object.entries(props.digest.sourceCounts).map(([source, count]) => <Tag key={source}>{source} {count}</Tag>)}
            </div>
            <div className="modal-list">
              {props.digest.topItems.length === 0
                ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今天还没有新信息" />
                : props.digest.topItems.map((item) => (
                  <div key={item.id}>
                    <span>{item.sourceName} · 重要度 {Math.round(item.importanceScore * 100)}</span>
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
