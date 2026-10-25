import type { FormEvent } from 'react';
import { Button, Checkbox, Drawer, Empty, Input, Switch, Tooltip } from 'antd';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import type { EditingValue, Keyword, SourceOption, Topic } from '../../shared/types';

type TopicSettingsDrawerProps = {
  open: boolean;
  sources: SourceOption[];
  selectedSources: string[];
  topicName: string;
  topicAliases: string;
  topicExcludes: string;
  topics: Topic[];
  enabledKeywordCount: number;
  keywordDrafts: Record<string, string>;
  onClose: () => void;
  onSelectedSourcesChange: (sources: string[]) => void;
  onTopicNameChange: (value: string) => void;
  onTopicAliasesChange: (value: string) => void;
  onTopicExcludesChange: (value: string) => void;
  onCreateTopic: (event: FormEvent) => void;
  onPatchTopic: (topic: Topic, update: Partial<Topic>) => void;
  onDeleteTopic: (topic: Topic) => void;
  onPatchKeyword: (topic: Topic, keyword: Keyword, update: Partial<Keyword>) => void;
  onDeleteKeyword: (topic: Topic, keyword: Keyword) => void;
  onAddKeyword: (topic: Topic) => void;
  onKeywordDraftChange: (topicId: string, value: string) => void;
  onStartEdit: (editing: EditingValue, value: string) => void;
};

export function TopicSettingsDrawer(props: TopicSettingsDrawerProps) {
  return (
    <Drawer title="关注与采集设置" size={440} open={props.open} onClose={props.onClose}>
      <section className="drawer-section">
        <div className="drawer-heading"><div><h2>采集来源</h2><p>选择每次运行时需要检索的平台</p></div><span>{props.selectedSources.length} 个已启用</span></div>
        <Checkbox.Group
          className="source-checkboxes"
          options={props.sources.map((source) => ({ label: source.name, value: source.id }))}
          value={props.selectedSources}
          onChange={(values) => props.onSelectedSourcesChange(values.map(String))}
        />
      </section>

      <section className="drawer-section">
        <div className="drawer-heading"><div><h2>新增主题</h2><p>主题用于组织关键词和排除词</p></div></div>
        <form className="topic-form" onSubmit={props.onCreateTopic}>
          <Input value={props.topicName} onChange={(event) => props.onTopicNameChange(event.target.value)} placeholder="主题名称，例如 AI Agent" />
          <Input value={props.topicAliases} onChange={(event) => props.onTopicAliasesChange(event.target.value)} placeholder="别名，使用逗号分隔" />
          <Input value={props.topicExcludes} onChange={(event) => props.onTopicExcludesChange(event.target.value)} placeholder="排除词，可选" />
          <Button type="primary" htmlType="submit" icon={<Plus size={14} />} disabled={!props.topicName.trim()}>新增主题</Button>
        </form>
      </section>

      <section className="drawer-section topic-management">
        <div className="drawer-heading"><div><h2>关注主题</h2><p>{props.enabledKeywordCount} 个关键词正在参与采集</p></div></div>
        {props.topics.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关注主题" />}
        {props.topics.map((topic) => (
          <div className={'topic-editor ' + (topic.enabled ? '' : 'disabled')} key={topic.id}>
            <div className="topic-editor-head">
              <Switch size="small" checked={topic.enabled} onChange={(enabled) => props.onPatchTopic(topic, { enabled })} />
              <strong>{topic.name}</strong>
              <div>
                <Tooltip title="编辑主题">
                  <Button aria-label={'编辑主题 ' + topic.name} type="text" icon={<Pencil size={13} />} onClick={() => props.onStartEdit({ kind: 'topic', topic }, topic.name)} />
                </Tooltip>
                <Tooltip title="删除主题">
                  <Button aria-label={'删除主题 ' + topic.name} type="text" danger icon={<Trash2 size={13} />} onClick={() => props.onDeleteTopic(topic)} />
                </Tooltip>
              </div>
            </div>
            {(topic.aliases.length > 0 || topic.excludeWords.length > 0) && (
              <p className="topic-detail">
                {topic.aliases.length > 0 ? '别名：' + topic.aliases.join('、') : ''}
                {topic.excludeWords.length > 0 ? ' · 排除：' + topic.excludeWords.join('、') : ''}
              </p>
            )}
            <div className="keyword-editor-list">
              {topic.keywords.map((keyword) => (
                <span className={keyword.enabled ? '' : 'disabled'} key={keyword.id}>
                  {keyword.value}
                  <button title="编辑关键词" onClick={() => props.onStartEdit({ kind: 'keyword', topic, keyword }, keyword.value)}><Pencil size={11} /></button>
                  <button title={keyword.enabled ? '暂停关键词' : '启用关键词'} onClick={() => props.onPatchKeyword(topic, keyword, { enabled: !keyword.enabled })}>{keyword.enabled ? <Eye size={11} /> : <EyeOff size={11} />}</button>
                  <button title="删除关键词" onClick={() => props.onDeleteKeyword(topic, keyword)}><Trash2 size={11} /></button>
                </span>
              ))}
            </div>
            <Input
              className="keyword-input"
              size="small"
              value={props.keywordDrafts[topic.id] ?? ''}
              onChange={(event) => props.onKeywordDraftChange(topic.id, event.target.value)}
              onPressEnter={() => props.onAddKeyword(topic)}
              placeholder="输入关键词后回车"
              suffix={<button title="添加关键词" onClick={() => props.onAddKeyword(topic)}><Plus size={13} /></button>}
            />
          </div>
        ))}
      </section>
    </Drawer>
  );
}
