import { useEffect, useRef } from 'react';
import { Alert, Spin, Typography, message } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { feishuCallbackRequest } from '../../services/auth';

export function FeishuCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const handledRef = useRef(false);
  const error = searchParams.get('error');
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    if (error) {
      message.error('飞书授权已取消');
      navigate('/login', { replace: true });
      return;
    }
    if (!code || !state) return;
    feishuCallbackRequest(code, state)
      .then((session) => {
        message.success('飞书登录成功');
        navigate(session.redirect?.startsWith('/') ? session.redirect : '/dashboard', { replace: true });
      })
      .catch((err: Error) => {
        message.error(err.message);
        navigate('/login', { replace: true });
      });
  }, [code, error, navigate, state]);

  if (!code || !state) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <Alert type="error" message="飞书登录回调缺少必要参数" />
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <Spin />
        <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
          正在完成飞书登录...
        </Typography.Paragraph>
      </section>
    </main>
  );
}
