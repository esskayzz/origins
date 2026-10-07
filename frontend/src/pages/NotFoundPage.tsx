import { useNavigate } from "react-router-dom";
import { Button, Result } from "antd";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle="Sorry, the page you visited does not exist."
      extra={
        <Button type="primary" onClick={() => navigate("/swap")}>
          Go to Swap
        </Button>
      }
    />
  );
}
