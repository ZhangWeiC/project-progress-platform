import { LockOutlined, LoginOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Divider, Form, Input, Typography, message } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { getAuthSession, getFeishuAuthorizeUrl, loginRequest } from '../../services/auth';

type LoginValues = {
  loginName: string;
  password: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mutation = useMutation({
    mutationFn: (values: LoginValues) => loginRequest(values.loginName, values.password),
    onSuccess: () => {
      message.success('登录成功');
      const redirect = searchParams.get('redirect');
      navigate(redirect?.startsWith('/') ? redirect : '/dashboard', { replace: true });
    },
    onError: (error) => message.error(error.message)
  });
  const feishuLogin = useMutation({
    mutationFn: () => getFeishuAuthorizeUrl(searchParams.get('redirect') ?? '/dashboard'),
    onSuccess: (payload) => {
      window.location.assign(payload.authorization_url);
    },
    onError: (error) => message.error(error.message)
  });

  if (getAuthSession()) return <Navigate to="/dashboard" replace />;

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="项目进度平台登录">
        <div className="login-mark">P</div>
        <Typography.Title level={2} className="login-title">项目进度平台登录</Typography.Title>
        <Typography.Text type="secondary">请输入账号和密码</Typography.Text>

        <Form<LoginValues>
          className="login-form"
          layout="vertical"
          size="large"
          onFinish={(values) => mutation.mutate(values)}
        >
          <Form.Item label="账号" name="loginName" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" placeholder="账号" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="密码" />
          </Form.Item>
          <Button block type="primary" icon={<LoginOutlined />} htmlType="submit" loading={mutation.isPending}>
            登录
          </Button>
        </Form>

        <Divider plain>或</Divider>
        <Button block icon={<LoginOutlined />} loading={feishuLogin.isPending} onClick={() => feishuLogin.mutate()}>
          飞书登录
        </Button>
      </section>
    </main>
  );
}
