import { useForm } from "@tanstack/react-form";
import {
  Button,
  FieldError,
  Input,
  type InputRef,
  Label,
  Spinner,
  Surface,
  TextField,
  useToast,
} from "heroui-native";
import { useRef } from "react";
import { Text, View } from "react-native";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { queryClient } from "@/utils/trpc";

const signUpSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "用户名至少 3 个字符")
      .max(20, "用户名不能超过 20 个字符")
      .regex(/^[a-zA-Z0-9_]+$/, "用户名只能包含字母、数字和下划线"),
    password: z.string().min(8, "密码至少 8 个字符"),
    confirmPassword: z.string().min(1, "请再次输入密码"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

function getErrorMessage(error: unknown): string | null {
  if (!error) return null;

  if (typeof error === "string") {
    return error;
  }

  if (Array.isArray(error)) {
    for (const issue of error) {
      const message = getErrorMessage(issue);
      if (message) {
        return message;
      }
    }
    return null;
  }

  if (typeof error === "object" && error !== null) {
    const maybeError = error as { message?: unknown };
    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }

  return null;
}

export function SignUp() {
  const passwordInputRef = useRef<InputRef>(null);
  const confirmPasswordInputRef = useRef<InputRef>(null);
  const { toast } = useToast();

  const form = useForm({
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: signUpSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      const username = value.username.trim();
      await authClient.signUp.email(
        {
          // The server replaces this with a placeholder derived from the username.
          email: "",
          name: username,
          username,
          password: value.password,
        },
        {
          onError(error) {
            toast.show({
              variant: "danger",
              label: getAuthErrorMessage(error.error, "注册失败，请稍后再试"),
            });
          },
          onSuccess() {
            formApi.reset();
            toast.show({
              variant: "success",
              label: "注册成功",
            });
            queryClient.refetchQueries();
          },
        },
      );
    },
  });

  return (
    <Surface variant="secondary" className="p-4 rounded-lg">
      <Text className="text-foreground font-medium mb-4">创建账号</Text>

      <View className="gap-3">
        <form.Field name="username">
          {(field) => {
            const error = getErrorMessage(field.state.meta.errors);
            return (
              <TextField isInvalid={!!error}>
                <Label>用户名</Label>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChangeText={field.handleChange}
                  placeholder="字母、数字或下划线"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => {
                    passwordInputRef.current?.focus();
                  }}
                />
                <FieldError>{error}</FieldError>
              </TextField>
            );
          }}
        </form.Field>

        <form.Field name="password">
          {(field) => {
            const error = getErrorMessage(field.state.meta.errors);
            return (
              <TextField isInvalid={!!error}>
                <Label>密码</Label>
                <Input
                  ref={passwordInputRef}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChangeText={field.handleChange}
                  placeholder="至少 8 个字符"
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => {
                    confirmPasswordInputRef.current?.focus();
                  }}
                />
                <FieldError>{error}</FieldError>
              </TextField>
            );
          }}
        </form.Field>

        <form.Field name="confirmPassword">
          {(field) => {
            const error = getErrorMessage(field.state.meta.errors);
            return (
              <TextField isInvalid={!!error}>
                <Label>确认密码</Label>
                <Input
                  ref={confirmPasswordInputRef}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChangeText={field.handleChange}
                  placeholder="再次输入密码"
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={form.handleSubmit}
                />
                <FieldError>{error}</FieldError>
              </TextField>
            );
          }}
        </form.Field>

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button onPress={form.handleSubmit} isDisabled={isSubmitting} className="mt-1">
              {isSubmitting ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Button.Label>注册</Button.Label>
              )}
            </Button>
          )}
        </form.Subscribe>
      </View>
    </Surface>
  );
}
